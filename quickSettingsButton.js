// SPDX-License-Identifier: GPL-3.0-or-later
//
// QuickSettingsButton: a full Quick Settings menu instance for secondary
// panels. This mirrors the (unexported) QuickSettings class in gnome-shell's
// ui/panel.js, instantiating the same status indicators so the menu opens on
// the monitor it lives on.
//
// Deliberately omitted compared to the primary panel's instance:
//  - Thunderbolt (its indicator posts notifications; a second instance would
//    duplicate them)
//  - the unsafe-mode indicator (not exported, rarely relevant)

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {
    QuickSettingsMenu,
    QuickSettingsItem,
    QuickSlider,
    SystemIndicator,
} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as SystemStatus from 'resource:///org/gnome/shell/ui/status/system.js';
import * as CameraStatus from 'resource:///org/gnome/shell/ui/status/camera.js';
import * as VolumeStatus from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as BrightnessStatus from 'resource:///org/gnome/shell/ui/status/brightness.js';
import * as RemoteAccessStatus from 'resource:///org/gnome/shell/ui/status/remoteAccess.js';
import * as LocationStatus from 'resource:///org/gnome/shell/ui/status/location.js';
import * as NightLightStatus from 'resource:///org/gnome/shell/ui/status/nightLight.js';
import * as DarkModeStatus from 'resource:///org/gnome/shell/ui/status/darkMode.js';
import * as DoNotDisturbStatus from 'resource:///org/gnome/shell/ui/status/doNotDisturb.js';
import * as BacklightStatus from 'resource:///org/gnome/shell/ui/status/backlight.js';
import * as PowerProfileStatus from 'resource:///org/gnome/shell/ui/status/powerProfiles.js';
import * as RFKillStatus from 'resource:///org/gnome/shell/ui/status/rfkill.js';
import * as AutoRotateStatus from 'resource:///org/gnome/shell/ui/status/autoRotate.js';
import * as BackgroundAppsStatus from 'resource:///org/gnome/shell/ui/status/backgroundApps.js';

const N_QUICK_SETTINGS_COLUMNS = 2;

// A clickable stand-in for a toggle another extension added to the MAIN
// Quick Settings menu. Visuals come from a live Clutter.Clone of the real
// toggle (so checked state, icon and label stay in sync); clicking emits
// 'clicked' on the real toggle, triggering the extension's own handler.
const QSItemMirror = GObject.registerClass(
class TopbarTweaksQSItemMirror extends St.Button {
    _init(source) {
        super._init({
            style_class: 'topbar-tweaks-qs-mirror',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            accessible_name: source.accessible_name ?? '',
        });

        this._source = source;
        this.set_child(new Clutter.Clone({source}));

        source.bind_property('visible', this, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        source.connectObject('destroy', () => this.destroy(), this);

        // Slight dim as hover/press feedback (the clone paints over any
        // background this button could draw itself)
        const feedback = () => {
            this.child.opacity = this.pressed ? 180 : this.hover ? 215 : 255;
        };
        this.connect('notify::hover', feedback);
        this.connect('notify::pressed', feedback);

        this.connect('clicked', (_a, button) =>
            this._source.emit('clicked', button));
    }
});

export const QuickSettingsButton = GObject.registerClass(
class TopbarTweaksQuickSettingsButton extends PanelMenu.Button {
    constructor(mirrorExternal) {
        super(0.0, 'System', true);

        this._mirrorExternal = mirrorExternal;
        this._externalMirrors = [];
        this._externalSyncId = 0;

        this._indicators = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        this.add_child(this._indicators);

        this.setMenu(new QuickSettingsMenu(this, N_QUICK_SETTINGS_COLUMNS));

        this.connect('destroy', () => {
            if (this._externalSyncId) {
                GLib.source_remove(this._externalSyncId);
                this._externalSyncId = 0;
            }
        });

        this._setupIndicators().catch(error =>
            logError(error, '[Topbar Tweaks] Failed to set up quick settings'));
    }

    async _setupIndicators() {
        if (Config.HAVE_NETWORKMANAGER) {
            const NetworkStatus =
                await import('resource:///org/gnome/shell/ui/status/network.js');
            this._network = new NetworkStatus.Indicator();
        } else {
            this._network = null;
        }

        if (Config.HAVE_BLUETOOTH) {
            const BluetoothStatus =
                await import('resource:///org/gnome/shell/ui/status/bluetooth.js');
            this._bluetooth = new BluetoothStatus.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._system = new SystemStatus.Indicator();
        this._camera = new CameraStatus.Indicator();
        this._volumeOutput = new VolumeStatus.OutputIndicator();
        this._volumeInput = new VolumeStatus.InputIndicator();
        this._brightness = new BrightnessStatus.Indicator();
        this._remoteAccess = new RemoteAccessStatus.RemoteAccessApplet();
        this._location = new LocationStatus.Indicator();
        this._nightLight = new NightLightStatus.Indicator();
        this._darkMode = new DarkModeStatus.Indicator();
        this._doNotDisturb = new DoNotDisturbStatus.Indicator();
        this._backlight = new BacklightStatus.Indicator();
        this._powerProfiles = new PowerProfileStatus.Indicator();
        this._rfkill = new RFKillStatus.Indicator();
        this._autoRotate = new AutoRotateStatus.Indicator();
        this._backgroundApps = new BackgroundAppsStatus.Indicator();

        // privacy-related indicators first, like the primary panel
        let pos = 0;
        this._indicators.insert_child_at_index(this._remoteAccess, pos++);
        this._indicators.insert_child_at_index(this._camera, pos++);
        this._indicators.insert_child_at_index(this._volumeInput, pos++);
        this._indicators.insert_child_at_index(this._location, pos++);

        this._indicators.add_child(this._brightness);
        this._indicators.add_child(this._nightLight);
        if (this._network)
            this._indicators.add_child(this._network);
        this._indicators.add_child(this._darkMode);
        this._indicators.add_child(this._doNotDisturb);
        this._indicators.add_child(this._backlight);
        if (this._bluetooth)
            this._indicators.add_child(this._bluetooth);
        this._indicators.add_child(this._rfkill);
        this._indicators.add_child(this._autoRotate);
        this._indicators.add_child(this._volumeOutput);
        this._indicators.add_child(this._powerProfiles);
        this._indicators.add_child(this._system);

        const sibling = this.menu.getFirstItem();
        this._addItemsBefore(this._system.quickSettingsItems,
            sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._volumeOutput.quickSettingsItems,
            sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._volumeInput.quickSettingsItems,
            sibling, N_QUICK_SETTINGS_COLUMNS);
        this._addItemsBefore(this._brightness.quickSettingsItems,
            sibling, N_QUICK_SETTINGS_COLUMNS);

        this._addItemsBefore(this._camera.quickSettingsItems, sibling);
        this._addItemsBefore(this._remoteAccess.quickSettingsItems, sibling);
        this._addItemsBefore(this._location.quickSettingsItems, sibling);
        if (this._network)
            this._addItemsBefore(this._network.quickSettingsItems, sibling);
        if (this._bluetooth)
            this._addItemsBefore(this._bluetooth.quickSettingsItems, sibling);
        this._addItemsBefore(this._powerProfiles.quickSettingsItems, sibling);
        this._addItemsBefore(this._nightLight.quickSettingsItems, sibling);
        this._addItemsBefore(this._darkMode.quickSettingsItems, sibling);
        this._addItemsBefore(this._doNotDisturb.quickSettingsItems, sibling);
        this._addItemsBefore(this._backlight.quickSettingsItems, sibling);
        this._addItemsBefore(this._rfkill.quickSettingsItems, sibling);
        this._addItemsBefore(this._autoRotate.quickSettingsItems, sibling);

        this._backgroundApps.quickSettingsItems.forEach(
            item => this.menu.addItem(item, N_QUICK_SETTINGS_COLUMNS));

        if (this._mirrorExternal)
            this._watchExternalItems();
    }

    _addItemsBefore(items, sibling, colSpan = 1) {
        items.forEach(item => this.menu.insertItemBefore(item, sibling, colSpan));
    }

    // --- Mirroring of toggles/indicators other extensions add to the MAIN
    // Quick Settings (caffeine, GSConnect, ...). They register through
    // Main.panel.statusArea.quickSettings.addExternalIndicator(); anything
    // in the main QS grid that does not belong to a built-in shell
    // indicator is considered external.

    _watchExternalItems() {
        const main = Main.panel.statusArea.quickSettings;
        if (!main?.menu?._grid)
            return;

        main.menu._grid.connectObject(
            'child-added', () => this._queueExternalSync(),
            'child-removed', () => this._queueExternalSync(),
            this);
        main._indicators?.connectObject(
            'child-added', () => this._queueExternalSync(),
            'child-removed', () => this._queueExternalSync(),
            this);

        this._syncExternalItems();
    }

    _queueExternalSync() {
        if (this._externalSyncId)
            return;
        this._externalSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._externalSyncId = 0;
            this._syncExternalItems();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncExternalItems() {
        const main = Main.panel.statusArea.quickSettings;
        if (!main?.menu?._grid)
            return;

        for (const mirror of this._externalMirrors.slice())
            mirror.destroy();
        this._externalMirrors = [];

        // Everything owned by the main QS button's built-in indicators
        const builtinIndicators = new Set();
        const builtinItems = new Set();
        for (const key of Object.keys(main)) {
            const value = main[key];
            if (value instanceof SystemIndicator) {
                builtinIndicators.add(value);
                for (const item of value.quickSettingsItems ?? [])
                    builtinItems.add(item);
            }
        }

        // Panel icons of external indicators (e.g. caffeine's cup)
        for (const child of main._indicators?.get_children() ?? []) {
            if (builtinIndicators.has(child))
                continue;
            const clone = new Clutter.Clone({
                source: child,
                y_align: Clutter.ActorAlign.CENTER,
            });
            // Fix the clone to the source's allocated size; otherwise it
            // requests the source's preferred size and the mismatch squashes
            // the painted content (e.g. battery meter icons).
            child.bind_property('width', clone, 'width',
                GObject.BindingFlags.SYNC_CREATE);
            child.bind_property('height', clone, 'height',
                GObject.BindingFlags.SYNC_CREATE);
            child.bind_property('visible', clone, 'visible',
                GObject.BindingFlags.SYNC_CREATE);
            child.connectObject('destroy', () => clone.destroy(), clone);
            this._indicators.insert_child_below(clone,
                this._brightness ?? null);
            this._trackMirror(clone);
        }

        // Toggles in the grid. Sliders and other custom widgets need real
        // pointer interaction that a clone cannot forward, so only
        // button-like items are mirrored.
        const grid = main.menu._grid;
        const sibling = this._backgroundApps?.quickSettingsItems?.at(-1) ?? null;
        for (const item of grid.get_children()) {
            if (builtinItems.has(item))
                continue;
            if (!(item instanceof QuickSettingsItem) || item instanceof QuickSlider)
                continue;

            let colSpan = 1;
            try {
                const meta = grid.layout_manager.get_child_meta(grid, item);
                colSpan = Math.min(Math.max(meta.columnSpan, 1),
                    N_QUICK_SETTINGS_COLUMNS);
            } catch {
                // keep default
            }

            const mirror = new QSItemMirror(item);
            if (sibling)
                this.menu.insertItemBefore(mirror, sibling, colSpan);
            else
                this.menu.addItem(mirror, colSpan);
            this._trackMirror(mirror);
        }
    }

    // Mirrors can destroy themselves when their source goes away (extension
    // disabled); drop them from the list so a later sync does not destroy
    // them a second time.
    _trackMirror(mirror) {
        this._externalMirrors.push(mirror);
        mirror.connect('destroy', () => {
            const index = this._externalMirrors.indexOf(mirror);
            if (index >= 0)
                this._externalMirrors.splice(index, 1);
        });
    }
});
