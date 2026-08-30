// SPDX-License-Identifier: GPL-3.0-or-later
//
// SecondaryPanel: a top-bar replica for non-primary monitors. It mirrors the
// layout logic of gnome-shell's ui/panel.js Panel, but populates itself from
// the extension settings and anchors all menus to its own monitor.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';
import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';
import {ATIndicator} from 'resource:///org/gnome/shell/ui/status/accessibility.js';
import {InputSourceIndicator} from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import {QuickSettingsButton} from './quickSettingsButton.js';
import {StatusAreaMirrors} from './mirrors.js';

// Blur my Shell blurs our panels through its multi-monitor-bar hook (it
// scans for uiGroup children named "panelBox"), but with its dynamic
// override disabled it only applies its transparency style class to panels
// that existed when it was enabled. Apply the configured class ourselves so
// late-created panels are transparent too; once Blur my Shell tracks the
// panel it adds/removes the class as usual.
export const BLUR_MY_SHELL_UUID = 'blur-my-shell@aunetx';
const BMS_PANEL_STYLES = [
    'transparent-panel', 'light-panel', 'dark-panel', 'contrasted-panel',
];

function blurMyShellPanelStyle() {
    try {
        const extension = Main.extensionManager.lookup(BLUR_MY_SHELL_UUID);
        if (extension?.state !== ExtensionState.ACTIVE || !extension.dir)
            return null;

        const source = Gio.SettingsSchemaSource.new_from_directory(
            extension.dir.get_child('schemas').get_path(),
            Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(
            'org.gnome.shell.extensions.blur-my-shell.panel', true);
        if (!schema)
            return null;

        const settings = new Gio.Settings({settings_schema: schema});
        if (!settings.get_boolean('blur') ||
            !settings.get_boolean('override-background'))
            return null;
        return BMS_PANEL_STYLES[settings.get_int('style-panel')] ?? null;
    } catch {
        return null;
    }
}

const WorkspaceDots = GObject.registerClass(
class TopbarTweaksWorkspaceDots extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'topbar-tweaks-dots',
            y_align: Clutter.ActorAlign.CENTER,
        });

        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._sync(),
            'notify::n-workspaces', () => this._sync(),
            this);
        this._sync();
    }

    _sync() {
        this.destroy_all_children();

        const nWorkspaces = global.workspace_manager.n_workspaces;
        const active = global.workspace_manager.get_active_workspace_index();

        for (let i = 0; i < nWorkspaces; i++) {
            const dot = new St.Widget({
                style_class: 'topbar-tweaks-dot',
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (i === active)
                dot.add_style_class_name('active');
            this.add_child(dot);
        }
    }
});

const ActivitiesButton = GObject.registerClass(
class TopbarTweaksActivitiesButton extends PanelMenu.Button {
    _init(showDots) {
        super._init(0.0, 'Activities', true);

        this.name = 'panelActivities';
        this.accessible_name = 'Activities';

        if (showDots)
            this.add_child(new WorkspaceDots());
        else
            this.add_child(new St.Label({
                text: 'Activities',
                y_align: Clutter.ActorAlign.CENTER,
            }));

        Main.overview.connectObject(
            'showing', () => this.add_style_pseudo_class('checked'),
            'hiding', () => this.remove_style_pseudo_class('checked'),
            this);

        // GNOME 49+ delivers clicks through gestures; older versions still
        // emit button-press-event on the actor.
        if (Clutter.ClickGesture) {
            const gesture = new Clutter.ClickGesture();
            gesture.connect('recognize', () => this._toggleOverview());
            this.add_action(gesture);
        } else {
            this.connect('button-press-event', () => {
                this._toggleOverview();
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    _toggleOverview() {
        if (Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();
    }

    vfunc_scroll_event(event) {
        return Main.wm.handleWorkspaceScroll(event);
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
            this._toggleOverview();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

export const SecondaryPanel = GObject.registerClass(
class TopbarTweaksPanel extends St.Widget {
    _init(settings, monitor) {
        super._init({
            // Reuse the shell theme's #panel styling
            name: 'panel',
            style_class: 'topbar-tweaks-panel',
            reactive: true,
        });

        this._settings = settings;
        this._monitor = monitor;

        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this.statusArea = {};
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({name: 'panelLeft'});
        this.add_child(this._leftBox);
        this._centerBox = new St.BoxLayout({name: 'panelCenter'});
        this.add_child(this._centerBox);
        this._rightBox = new St.BoxLayout({name: 'panelRight'});
        this.add_child(this._rightBox);

        Main.overview.connectObject(
            'showing', () => this._onOverviewShowing(),
            'hiding', () => this._onOverviewHiding(),
            this);

        global.display.connectObject('workareas-changed',
            () => this.queue_relayout(), this);

        this._populate();
        this.updateStyle();

        Main.ctrlAltTabManager.addGroup(this,
            `Top Bar (Monitor ${monitor.index + 1})`,
            'shell-focus-top-bar-symbolic',
            {sortGroup: CtrlAltTab.SortGroup.TOP});

        this.connect('destroy', () => {
            this._statusMirrors?.destroy();
            this._statusMirrors = null;
            Main.ctrlAltTabManager.removeGroup(this);
        });
    }

    _populate() {
        const show = key => this._settings.get_boolean(key);
        const clockPosition = this._settings.get_string('clock-position');
        const boxes = {
            left: this._leftBox,
            center: this._centerBox,
            right: this._rightBox,
        };

        if (show('show-activities')) {
            this._addIndicator('activities',
                new ActivitiesButton(show('show-workspace-dots')),
                this._leftBox);
        }

        if (show('show-date-menu')) {
            this._addIndicator('dateMenu',
                new DateMenuButton(),
                boxes[clockPosition] ?? this._centerBox);
        }

        if (show('show-a11y'))
            this._addIndicator('a11y', new ATIndicator(this), this._rightBox);

        if (show('show-keyboard'))
            this._addIndicator('keyboard', new InputSourceIndicator(this), this._rightBox);

        if (show('show-quick-settings')) {
            this._addIndicator('quickSettings',
                new QuickSettingsButton(show('mirror-quick-settings')),
                this._rightBox);
        }

        // Added last so the mirror containers slot in around the built-in
        // items (left/center: appended; right: before the built-ins).
        if (show('mirror-indicators'))
            this._statusMirrors = new StatusAreaMirrors(this);
    }

    _addIndicator(role, indicator, box) {
        this.statusArea[role] = indicator;
        box.add_child(indicator.container);

        indicator.connectObject(
            'destroy', () => delete this.statusArea[role],
            'menu-set', () => this._onMenuSet(indicator),
            this);
        this._onMenuSet(indicator);
    }

    _onMenuSet(indicator) {
        if (!indicator.menu || indicator.menu._topbarTweaksManaged)
            return;

        indicator.menu._topbarTweaksManaged = true;
        this.menuManager.addMenu(indicator.menu);
    }

    _onOverviewShowing() {
        this.add_style_pseudo_class('overview');
        if (this._settings.get_boolean('hide-in-overview')) {
            this.opacity = 0;
            this.reactive = false;
        }
    }

    _onOverviewHiding() {
        this.remove_style_pseudo_class('overview');
        this.opacity = 255;
        this.reactive = true;
    }

    updateStyle() {
        let style = '';

        const height = this._settings.get_int('panel-height');
        if (height > 0)
            style += `height: ${height}px;`;

        const opacity = this._settings.get_double('background-opacity');
        const custom = this._settings.get_boolean('custom-background');
        if (custom || opacity < 0.999) {
            let [r, g, b] = [0, 0, 0];
            if (custom) {
                const hex = this._settings.get_string('background-color');
                const match = /^#?([0-9a-f]{6})$/i.exec(hex);
                if (match) {
                    r = parseInt(match[1].slice(0, 2), 16);
                    g = parseInt(match[1].slice(2, 4), 16);
                    b = parseInt(match[1].slice(4, 6), 16);
                }
            }
            style += `background-color: rgba(${r}, ${g}, ${b}, ${opacity.toFixed(3)});`;
        }

        this.style = style || null;

        for (const styleClass of BMS_PANEL_STYLES)
            this.remove_style_class_name(styleClass);
        const bmsStyle = blurMyShellPanelStyle();
        if (bmsStyle)
            this.add_style_class_name(bmsStyle);

        // If the overview is open right now, honor hide-in-overview changes
        if (Main.overview.visible)
            this._onOverviewShowing();
        else
            this._onOverviewHiding();
    }

    vfunc_get_preferred_width(_forHeight) {
        return [0, this._monitor.width];
    }

    // Same three-box allocation as gnome-shell's Panel, with the center box
    // shifted to stay centered relative to this monitor's work area.
    vfunc_allocate(box) {
        this.set_allocation(box);

        const allocWidth = box.x2 - box.x1;
        const allocHeight = box.y2 - box.y1;

        const [, leftNaturalWidth] = this._leftBox.get_preferred_width(-1);
        const [, centerNaturalWidth] = this._centerBox.get_preferred_width(-1);
        const [, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        const centerWidth = centerNaturalWidth;

        const monitor = Main.layoutManager.findMonitorForActor(this);
        let centerOffset = 0;
        if (monitor) {
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
        }

        const sideWidth = Math.max(0, (allocWidth - centerWidth + centerOffset) / 2);

        const childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = Math.max(
                allocWidth - Math.min(Math.floor(sideWidth), leftNaturalWidth),
                0);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth), leftNaturalWidth);
        }
        this._leftBox.allocate(childBox);

        childBox.x1 = Math.ceil(sideWidth);
        childBox.y1 = 0;
        childBox.x2 = childBox.x1 + centerWidth;
        childBox.y2 = allocHeight;
        this._centerBox.allocate(childBox);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth), rightNaturalWidth);
        } else {
            childBox.x1 = Math.max(
                allocWidth - Math.min(Math.floor(sideWidth), rightNaturalWidth),
                0);
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox);
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            global.display.focus_default_window(event.get_time());
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }
});
