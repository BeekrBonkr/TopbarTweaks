// SPDX-License-Identifier: GPL-3.0-or-later
//
// Status-area mirroring: live, clickable replicas of the indicators that
// OTHER extensions add to the main top bar (AppIndicator tray icons,
// clipboard managers, caffeine, drive menu, ...).
//
// An actor can only have one parent, so the real indicator stays on the
// primary bar and each secondary bar shows a Clutter.Clone of it (the clone
// repaints automatically, so icon changes are always in sync). Interaction
// is provided two ways:
//  - menus: a PopupMenu re-reads `sourceActor` every time it opens, so the
//    mirror temporarily re-anchors the indicator's real menu to itself and
//    the menu pops up on this monitor, then restores the anchor on close;
//  - custom click/scroll handling (AppIndicator activation, middle-click
//    secondary-activate, scroll wheel): the raw event is forwarded to the
//    real indicator with clutter_actor_event().

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Roles implemented by gnome-shell itself (and replicated natively by
// SecondaryPanel); everything else in the main panel's boxes comes from
// other extensions and gets mirrored.
const BUILTIN_ROLES = [
    'activities', 'appMenu', 'dateMenu', 'a11y', 'keyboard', 'quickSettings',
    'dwellClick', 'screenRecording', 'screenSharing',
];

// How long a re-anchored menu may stay closed before the anchor swap is
// undone (covers AppIndicator's double-click grace period, which opens the
// menu asynchronously after the click).
const ANCHOR_TIMEOUT_MS = 1500;

// Temporarily anchor `menu` to `actor`, restoring the original sourceActor
// when the menu closes (or never opens).
export function anchorMenuTo(menu, actor) {
    if (!menu._topbarTweaksAnchor) {
        menu._topbarTweaksAnchor = {
            sourceActor: menu.sourceActor,
            focusActor: menu.focusActor,
            signalId: menu.connect('open-state-changed', (m, open) => {
                if (!open)
                    restoreAnchor(m);
            }),
            timeoutId: 0,
        };
    } else if (menu._topbarTweaksAnchor.timeoutId) {
        GLib.source_remove(menu._topbarTweaksAnchor.timeoutId);
        menu._topbarTweaksAnchor.timeoutId = 0;
    }

    menu.sourceActor = actor;
    menu.focusActor = actor;

    if (!menu.isOpen) {
        menu._topbarTweaksAnchor.timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, ANCHOR_TIMEOUT_MS, () => {
                menu._topbarTweaksAnchor.timeoutId = 0;
                if (!menu.isOpen)
                    restoreAnchor(menu);
                return GLib.SOURCE_REMOVE;
            });
    }
}

export function restoreAnchor(menu) {
    const anchor = menu._topbarTweaksAnchor;
    if (!anchor)
        return;
    delete menu._topbarTweaksAnchor;

    menu.disconnect(anchor.signalId);
    if (anchor.timeoutId)
        GLib.source_remove(anchor.timeoutId);
    menu.sourceActor = anchor.sourceActor;
    menu.focusActor = anchor.focusActor;
}

// Whether the indicator implements its own press/event handling (like
// AppIndicator's activate / double-click / secondary-activate logic) rather
// than relying on PanelMenu.Button's menu-toggle gesture. Only JS-defined
// prototypes are walked; registerClass() puts vfunc overrides there as own
// properties.
function handlesOwnClicks(source) {
    for (let proto = Object.getPrototypeOf(source);
        proto;
        proto = Object.getPrototypeOf(proto)) {
        if (proto === PanelMenu.ButtonBox.prototype ||
            proto === St.Button.prototype ||
            proto === St.Bin.prototype ||
            proto === St.Widget.prototype ||
            proto === Clutter.Actor.prototype)
            break;
        if (Object.prototype.hasOwnProperty.call(proto, 'vfunc_button_press_event') ||
            Object.prototype.hasOwnProperty.call(proto, 'vfunc_event'))
            return true;
    }
    return false;
}

const IndicatorMirror = GObject.registerClass(
class TopbarTweaksIndicatorMirror extends St.Button {
    _init(container, source) {
        super._init({
            style_class: 'panel-button topbar-tweaks-mirror',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: source.accessible_name ?? '',
        });

        this._source = source;

        // Fix the clone to the source's real size so a different bar height
        // never distorts the icon; the St.Bin centers it vertically.
        const clone = new Clutter.Clone({source});
        source.bind_property('width', clone, 'width',
            GObject.BindingFlags.SYNC_CREATE);
        source.bind_property('height', clone, 'height',
            GObject.BindingFlags.SYNC_CREATE);
        this.set_child(new St.Bin({
            y_align: Clutter.ActorAlign.CENTER,
            child: clone,
        }));

        // Extensions hide either their button or its container; a clone
        // would paint the source even while it is hidden, so track both.
        const syncVisible = () => {
            this.visible = container.visible && source.visible;
        };
        container.connectObject('notify::visible', syncVisible, this);
        source.connectObject(
            'notify::visible', syncVisible,
            'destroy', () => this.destroy(),
            this);
        syncVisible();

        this.connect('button-press-event',
            (_actor, event) => this._onPress(event));
        this.connect('scroll-event',
            (_actor, event) => this._source.event(event, false));
        // Keyboard activation (Enter/Space); pointer presses are consumed
        // above and never reach St.Button's own click handling.
        this.connect('clicked', () => this._toggleMenu());

        this.connect('destroy', () => this._onDestroy());
    }

    _menu() {
        const menu = this._source.menu;
        return menu instanceof PopupMenu.PopupMenu ? menu : null;
    }

    _onPress(event) {
        const menu = this._menu();

        if (event.get_button() === Clutter.BUTTON_MIDDLE) {
            // e.g. AppIndicator secondary-activate; never opens a popup
            this._source.event(event, false);
            return Clutter.EVENT_STOP;
        }

        if (handlesOwnClicks(this._source) || !menu) {
            // Let the indicator run its own logic; if that logic opens the
            // menu (possibly async), it opens here thanks to the anchor.
            if (menu)
                anchorMenuTo(menu, this);
            this._source.event(event, false);
            return Clutter.EVENT_STOP;
        }

        this._toggleMenu();
        return Clutter.EVENT_STOP;
    }

    _toggleMenu() {
        const menu = this._menu();
        if (!menu)
            return;
        if (menu.isOpen) {
            menu.close();
        } else {
            anchorMenuTo(menu, this);
            menu.open();
        }
    }

    _onDestroy() {
        const menu = this._menu();
        if (menu?._topbarTweaksAnchor &&
            menu.sourceActor === this) {
            if (menu.isOpen)
                menu.close();
            restoreAnchor(menu);
        }
    }
});

// Watches the main panel's three boxes and maintains one row of mirrors per
// box on a SecondaryPanel.
export class StatusAreaMirrors {
    constructor(panel) {
        this._panel = panel;
        this._syncId = 0;

        this._boxes = new Map([
            [Main.panel._leftBox, new St.BoxLayout({name: 'topbarTweaksMirrorsLeft'})],
            [Main.panel._centerBox, new St.BoxLayout({name: 'topbarTweaksMirrorsCenter'})],
            [Main.panel._rightBox, new St.BoxLayout({name: 'topbarTweaksMirrorsRight'})],
        ]);

        panel._leftBox.add_child(this._boxes.get(Main.panel._leftBox));
        panel._centerBox.add_child(this._boxes.get(Main.panel._centerBox));
        // Extension icons sit left of the built-in right-side items, like on
        // the main bar
        panel._rightBox.insert_child_at_index(
            this._boxes.get(Main.panel._rightBox), 0);

        for (const mainBox of this._boxes.keys()) {
            mainBox.connectObject(
                'child-added', () => this._queueSync(),
                'child-removed', () => this._queueSync(),
                this);
        }

        this._sync();
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const builtins = new Set();
        for (const role of BUILTIN_ROLES) {
            const indicator = Main.panel.statusArea[role];
            if (indicator)
                builtins.add(indicator.container ?? indicator);
        }

        for (const [mainBox, mirrorBox] of this._boxes) {
            mirrorBox.destroy_all_children();

            for (const child of mainBox.get_children()) {
                if (builtins.has(child))
                    continue;

                // addToStatusArea() adds the PanelMenu.Button's container
                // (an St.Bin); a few extensions add raw actors directly.
                const source = child instanceof St.Bin
                    ? child.get_child() : child;
                if (!source)
                    continue;

                mirrorBox.add_child(new IndicatorMirror(child, source));
            }
        }
    }

    destroy() {
        for (const mainBox of this._boxes.keys())
            mainBox.disconnectObject(this);

        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }

        for (const mirrorBox of this._boxes.values())
            mirrorBox.destroy();
        this._boxes.clear();
        this._panel = null;
    }
}
