// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function bindCombo(settings, key, comboRow, values) {
    comboRow.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    comboRow.connect('notify::selected', () => {
        settings.set_string(key, values[comboRow.selected]);
    });
    settings.connect(`changed::${key}`, () => {
        const index = values.indexOf(settings.get_string(key));
        if (index >= 0 && index !== comboRow.selected)
            comboRow.selected = index;
    });
}

function rgbaToHex(rgba) {
    const to2 = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${to2(rgba.red)}${to2(rgba.green)}${to2(rgba.blue)}`;
}

export default class TopbarTweaksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive for the window's lifetime

        window.add(this._buildMonitorsPage(settings));
        window.add(this._buildItemsPage(settings));
        window.add(this._buildAppearancePage(settings));
    }

    _buildMonitorsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Monitors',
            icon_name: 'video-display-symbolic',
        });

        const modeGroup = new Adw.PreferencesGroup({
            title: 'Monitor Selection',
            description: 'The primary monitor always keeps the regular system top bar. ' +
                'This extension adds bars to the other monitors.',
        });
        page.add(modeGroup);

        const modeRow = new Adw.ComboRow({
            title: 'Add a top bar to',
            model: Gtk.StringList.new(['All secondary monitors', 'Selected monitors only']),
        });
        bindCombo(settings, 'monitor-mode', modeRow, ['all', 'custom']);
        modeGroup.add(modeRow);

        const listGroup = new Adw.PreferencesGroup({
            title: 'Selected Monitors',
            description: 'Used when "Selected monitors only" is chosen above.',
        });
        page.add(listGroup);

        const updateSensitive = () => {
            listGroup.sensitive = settings.get_string('monitor-mode') === 'custom';
        };
        settings.connect('changed::monitor-mode', updateSensitive);
        updateSensitive();

        const display = Gdk.Display.get_default();
        const monitors = display?.get_monitors();
        const nMonitors = monitors?.get_n_items() ?? 0;

        if (nMonitors === 0) {
            listGroup.add(new Adw.ActionRow({
                title: 'No monitors detected',
                subtitle: 'Could not query the display configuration.',
            }));
            return page;
        }

        for (let i = 0; i < nMonitors; i++) {
            const monitor = monitors.get_item(i);
            const connector = monitor.get_connector() ?? `monitor-${i}`;

            const row = new Adw.SwitchRow({
                title: connector,
                subtitle: monitor.get_description?.() ?? monitor.get_model() ?? '',
            });
            row.active = settings.get_strv('enabled-monitors').includes(connector);
            row.connect('notify::active', () => {
                const enabled = new Set(settings.get_strv('enabled-monitors'));
                if (row.active)
                    enabled.add(connector);
                else
                    enabled.delete(connector);
                settings.set_strv('enabled-monitors', [...enabled]);
            });
            listGroup.add(row);
        }

        return page;
    }

    _buildItemsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Panel Items',
            icon_name: 'view-grid-symbolic',
        });

        const itemsGroup = new Adw.PreferencesGroup({
            title: 'Items',
            description: 'What to show on the extra top bars.',
        });
        page.add(itemsGroup);

        const switches = [
            ['show-activities', 'Activities button', 'Toggles the overview, scroll to switch workspaces'],
            ['show-workspace-dots', 'Workspace dots', 'Show workspace dots in the Activities button instead of a text label'],
            ['show-date-menu', 'Clock and calendar', 'Date, time, notifications and calendar menu'],
            ['show-quick-settings', 'Quick Settings', 'Volume, brightness, network and other system controls'],
            ['show-a11y', 'Accessibility menu', ''],
            ['show-keyboard', 'Keyboard layout indicator', ''],
        ];
        for (const [key, title, subtitle] of switches) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            itemsGroup.add(row);
        }

        const layoutGroup = new Adw.PreferencesGroup({title: 'Layout'});
        page.add(layoutGroup);

        const clockRow = new Adw.ComboRow({
            title: 'Clock position',
            model: Gtk.StringList.new(['Left', 'Center', 'Right']),
        });
        bindCombo(settings, 'clock-position', clockRow, ['left', 'center', 'right']);
        layoutGroup.add(clockRow);

        return page;
    }

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });

        const appearanceGroup = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearanceGroup);

        const positionRow = new Adw.ComboRow({
            title: 'Bar position',
            subtitle: 'Screen edge for the extra bars',
            model: Gtk.StringList.new(['Top', 'Bottom']),
        });
        bindCombo(settings, 'panel-position', positionRow, ['top', 'bottom']);
        appearanceGroup.add(positionRow);

        const heightRow = new Adw.SpinRow({
            title: 'Bar height',
            subtitle: '0 uses the theme default',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 128, step_increment: 1, page_increment: 8,
            }),
        });
        settings.bind('panel-height', heightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(heightRow);

        const opacityRow = new Adw.SpinRow({
            title: 'Background opacity',
            subtitle: '100% is fully opaque',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 100, step_increment: 5, page_increment: 10,
            }),
        });
        opacityRow.value = Math.round(settings.get_double('background-opacity') * 100);
        opacityRow.connect('notify::value', () => {
            settings.set_double('background-opacity', opacityRow.value / 100);
        });
        appearanceGroup.add(opacityRow);

        const customBgRow = new Adw.SwitchRow({
            title: 'Custom background color',
            subtitle: 'Override the theme background of the extra bars',
        });
        settings.bind('custom-background', customBgRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(customBgRow);

        const colorRow = new Adw.ActionRow({title: 'Background color'});
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const initial = new Gdk.RGBA();
        initial.parse(settings.get_string('background-color'));
        colorButton.set_rgba(initial);
        colorButton.connect('notify::rgba', () => {
            settings.set_string('background-color', rgbaToHex(colorButton.get_rgba()));
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        appearanceGroup.add(colorRow);

        settings.bind('custom-background', colorRow, 'sensitive', Gio.SettingsBindFlags.GET);

        const behaviorGroup = new Adw.PreferencesGroup({title: 'Behavior'});
        page.add(behaviorGroup);

        const overviewRow = new Adw.SwitchRow({
            title: 'Hide in overview',
            subtitle: 'Hide the extra bars while the Activities overview is open',
        });
        settings.bind('hide-in-overview', overviewRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(overviewRow);

        const fullscreenRow = new Adw.SwitchRow({
            title: 'Hide on fullscreen',
            subtitle: 'Hide a bar while a window is fullscreen on its monitor',
        });
        settings.bind('hide-on-fullscreen', fullscreenRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(fullscreenRow);

        return page;
    }
}
