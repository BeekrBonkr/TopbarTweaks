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

// [title, subtitle, url] shown on the About page.
const LINKS = [
    ['Topbar Tweaks on GitHub', 'Source code, issues and releases',
        'https://github.com/BeekrBonkr/TopbarTweaks'],
    ['Report an issue', 'Bugs, feature requests and questions',
        'https://github.com/BeekrBonkr/TopbarTweaks/issues'],
    ['Always On Indicate', 'My other extension: see and manage always-on-top and sticky windows',
        'https://github.com/BeekrBonkr/AlwaysOnIndicate'],
    ['BeekrBonkr on GitHub', 'More of my projects', 'https://github.com/BeekrBonkr'],
];

// A row that opens a web page in the default browser when activated.
function linkRow(window, title, subtitle, uri, icon = 'adw-external-link-symbolic') {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? '', activatable: true});
    row.add_suffix(new Gtk.Image({icon_name: icon, valign: Gtk.Align.CENTER}));
    row.connect('activated', () => {
        new Gtk.UriLauncher({uri}).launch(window.get_root?.() ?? window, null, (launcher, result) => {
            try {
                launcher.launch_finish(result);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`Could not open ${uri}: ${e.message}`);
            }
        });
    });
    return row;
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
        window.add(this._buildAnimationPage(settings));
        window.add(this._buildAboutPage(window));
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
            ['mirror-indicators', 'Icons from other extensions',
                'Mirror app tray icons and other indicators from the main top bar; ' +
                'their menus open on the bar you click'],
            ['mirror-quick-settings', 'Quick Settings toggles from other extensions',
                'Mirror toggles that other extensions add to the main Quick Settings menu'],
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

        return page;
    }

    _buildAnimationPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Animation',
            icon_name: 'media-playback-start-symbolic',
        });

        const spinRow = (key, title, subtitle, lower, upper, step) => {
            const row = new Adw.SpinRow({
                title, subtitle,
                adjustment: new Gtk.Adjustment({
                    lower, upper, step_increment: step, page_increment: step * 4,
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        // --- Fullscreen hiding + slide animation ---

        const slideGroup = new Adw.PreferencesGroup({
            title: 'Fullscreen Slide',
            description: 'How top bars leave and re-enter the screen when a ' +
                'window goes fullscreen.',
        });
        page.add(slideGroup);

        const fullscreenRow = new Adw.SwitchRow({
            title: 'Hide extra bars on fullscreen',
            subtitle: 'Hide a secondary bar while a window is fullscreen on ' +
                'its monitor (the main top bar always hides)',
        });
        settings.bind('hide-on-fullscreen', fullscreenRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        slideGroup.add(fullscreenRow);

        const animBarsRow = new Adw.ComboRow({
            title: 'Animated bars',
            subtitle: 'Bars not selected here appear and disappear instantly, ' +
                'like stock GNOME',
            model: Gtk.StringList.new([
                'All bars', 'Main bar only', 'Secondary bars only',
                'None (instant)',
            ]),
        });
        bindCombo(settings, 'animate-fullscreen-bars', animBarsRow,
            ['all', 'main', 'secondary', 'none']);
        slideGroup.add(animBarsRow);

        slideGroup.add(spinRow('animation-duration-hide', 'Slide-out duration',
            'Milliseconds for a bar to leave the screen', 0, 2000, 25));
        slideGroup.add(spinRow('animation-duration-show', 'Slide-in duration',
            'Milliseconds for a bar to return', 0, 2000, 25));

        const easingRow = new Adw.ComboRow({
            title: 'Interpolation',
            subtitle: 'Easing curve of the slide',
            model: Gtk.StringList.new([
                'Linear',
                'Ease in (quad)',
                'Ease out (quad)',
                'Ease in-out (quad)',
                'Ease out (cubic)',
                'Ease in-out (cubic)',
                'Ease out (quart)',
                'Ease out (quint)',
                'Ease out (expo)',
                'Ease in-out (sine)',
                'Ease out (circ)',
                'Overshoot (back)',
                'Elastic',
                'Bounce',
            ]),
        });
        bindCombo(settings, 'animation-interpolation', easingRow, [
            'linear',
            'ease-in-quad',
            'ease-out-quad',
            'ease-in-out-quad',
            'ease-out-cubic',
            'ease-in-out-cubic',
            'ease-out-quart',
            'ease-out-quint',
            'ease-out-expo',
            'ease-in-out-sine',
            'ease-out-circ',
            'ease-out-back',
            'ease-out-elastic',
            'ease-out-bounce',
        ]);
        slideGroup.add(easingRow);

        // --- Pressure reveal ---

        const revealGroup = new Adw.PreferencesGroup({
            title: 'Pressure Reveal',
            description: 'Temporarily slide a hidden bar back in by pushing ' +
                'the mouse against the screen edge it hides behind.',
        });
        page.add(revealGroup);

        const revealRow = new Adw.SwitchRow({
            title: 'Reveal hidden bars with the mouse',
        });
        settings.bind('pressure-reveal', revealRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        revealGroup.add(revealRow);

        const revealBarsRow = new Adw.ComboRow({
            title: 'Bars that can be revealed',
            model: Gtk.StringList.new([
                'All bars', 'Main bar only', 'Secondary bars only',
            ]),
        });
        bindCombo(settings, 'pressure-reveal-bars', revealBarsRow,
            ['all', 'main', 'secondary']);
        revealGroup.add(revealBarsRow);

        const thresholdRow = spinRow('pressure-threshold', 'Required pressure',
            'How hard to push against the edge, in pixels of pointer travel',
            10, 500, 10);
        revealGroup.add(thresholdRow);

        const timeoutRow = spinRow('pressure-timeout', 'Pressure window',
            'Milliseconds in which the pressure must build up; slow drifts ' +
            'against the edge are ignored', 100, 5000, 100);
        revealGroup.add(timeoutRow);

        const delayRow = spinRow('reveal-hide-delay', 'Hide delay',
            'Milliseconds after the mouse leaves a revealed bar before it ' +
            'slides back out', 0, 5000, 50);
        revealGroup.add(delayRow);

        for (const row of [revealBarsRow, thresholdRow, timeoutRow, delayRow]) {
            settings.bind('pressure-reveal', row, 'sensitive',
                Gio.SettingsBindFlags.GET);
        }

        return page;
    }

    _buildAboutPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });

        const info = new Adw.PreferencesGroup({
            title: this.metadata.name,
            description: this.metadata.description,
        });
        page.add(info);
        const version = this.metadata['version-name'] ?? this.metadata.version ?? 'development';
        info.add(new Adw.ActionRow({title: 'Version', subtitle: String(version)}));
        info.add(new Adw.ActionRow({title: 'License', subtitle: 'GPL-3.0-or-later'}));

        const links = new Adw.PreferencesGroup({title: 'Links'});
        page.add(links);
        for (const [title, subtitle, uri] of LINKS)
            links.add(linkRow(window, title, subtitle, uri));

        const support = new Adw.PreferencesGroup({
            title: 'Support',
            description: 'This extension is free and open source, built in my spare ' +
                'time. If it saved you some time or you would like to see it keep ' +
                'getting updates, you can buy me a coffee.',
        });
        page.add(support);
        support.add(linkRow(window, 'Buy me a coffee on Ko-fi', 'ko-fi.com/bkrbnkr',
            'https://ko-fi.com/bkrbnkr', 'emblem-favorite-symbolic'));

        return page;
    }
}
