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

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {QuickSettingsMenu} from 'resource:///org/gnome/shell/ui/quickSettings.js';

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

export const QuickSettingsButton = GObject.registerClass(
class TopbarTweaksQuickSettingsButton extends PanelMenu.Button {
    constructor() {
        super(0.0, 'System', true);

        this._indicators = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        this.add_child(this._indicators);

        this.setMenu(new QuickSettingsMenu(this, N_QUICK_SETTINGS_COLUMNS));

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
    }

    _addItemsBefore(items, sibling, colSpan = 1) {
        items.forEach(item => this.menu.insertItemBefore(item, sibling, colSpan));
    }
});
