// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SecondaryPanel} from './panel.js';

// Settings keys that only affect styling; everything else rebuilds the panels.
const STYLE_KEYS = new Set([
    'panel-height',
    'custom-background',
    'background-color',
    'background-opacity',
    'hide-in-overview',
]);

// One chrome box + panel per secondary monitor, equivalent to
// Main.layoutManager.panelBox for the primary monitor.
class SecondaryPanelBox {
    constructor(settings, monitor) {
        this._settings = settings;
        this._monitor = monitor;
        this._atBottom = settings.get_string('panel-position') === 'bottom';

        this.box = new St.BoxLayout({name: 'topbarTweaksPanelBox'});

        Main.layoutManager.addChrome(this.box, {
            affectsStruts: true,
            trackFullscreen: settings.get_boolean('hide-on-fullscreen'),
        });

        this.panel = new SecondaryPanel(settings, monitor);
        this.box.add_child(this.panel);

        this.box.set_size(monitor.width, -1);
        this._updatePosition();
        if (this._atBottom) {
            // The bottom edge depends on the allocated height
            this._heightId = this.box.connect('notify::height',
                () => this._updatePosition());
        }
    }

    _updatePosition() {
        const m = this._monitor;
        if (this._atBottom)
            this.box.set_position(m.x, m.y + m.height - this.box.height);
        else
            this.box.set_position(m.x, m.y);
    }

    destroy() {
        if (this._heightId) {
            this.box.disconnect(this._heightId);
            this._heightId = 0;
        }
        Main.layoutManager.removeChrome(this.box);
        this.box.destroy();
        this.box = null;
        this.panel = null;
    }
}

export default class TopbarTweaksExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._panelBoxes = [];
        this._rebuildId = 0;

        Main.layoutManager.connectObject('monitors-changed',
            () => this._queueRebuild(), this);
        this._settings.connectObject('changed',
            (_s, key) => this._onSettingsChanged(key), this);

        // If the shell is still starting up, layout is not final yet; the
        // monitors-changed signal will fire once it is.
        this._rebuild();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);

        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }

        this._destroyPanels();
        this._settings = null;
    }

    _onSettingsChanged(key) {
        if (STYLE_KEYS.has(key)) {
            for (const panelBox of this._panelBoxes)
                panelBox.panel.updateStyle();
        } else {
            this._queueRebuild();
        }
    }

    // Coalesce bursts (monitors-changed fires per change; prefs may write
    // several keys at once) into a single rebuild.
    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyPanels() {
        for (const panelBox of this._panelBoxes)
            panelBox.destroy();
        this._panelBoxes = [];
    }

    _rebuild() {
        this._destroyPanels();

        for (const monitor of Main.layoutManager.monitors) {
            if (monitor.index === Main.layoutManager.primaryIndex)
                continue;
            if (!this._monitorEnabled(monitor))
                continue;

            this._panelBoxes.push(
                new SecondaryPanelBox(this._settings, monitor));
        }
    }

    _monitorEnabled(monitor) {
        if (this._settings.get_string('monitor-mode') !== 'custom')
            return true;

        const monitorManager = global.backend.get_monitor_manager();
        return this._settings.get_strv('enabled-monitors').some(connector =>
            monitorManager.get_monitor_for_connector(connector) === monitor.index);
    }
}
