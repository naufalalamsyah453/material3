import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {orderedCategories, serializeCustom} from './features/dock/categories.js';

const SOURCES = ['real-name', 'username', 'hostname', 'custom'];
const THEMES = ['lavender', 'sage', 'ocean', 'terracotta'];
const ACCENTS = ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'slate'];
const ACCENT_NAMES = ['Purple', 'Blue', 'Teal', 'Green', 'Yellow', 'Orange', 'Red', 'Pink', 'Slate'];

export default class Material3Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Quick Settings header'),
            description: _('Choose the name shown next to the avatar.'),
        });
        page.add(group);

        const labels = [
            `${_('Full name')} (${GLib.get_real_name()})`,
            `${_('Username')} (${GLib.get_user_name()})`,
            `${_('Computer name')} (${GLib.get_host_name()})`,
            _('Custom'),
        ];
        const combo = new Adw.ComboRow({
            title: _('Name'),
            model: Gtk.StringList.new(labels),
            selected: Math.max(0, SOURCES.indexOf(settings.get_string('name-source'))),
        });
        combo.connect('notify::selected', () =>
            settings.set_string('name-source', SOURCES[combo.selected]));
        group.add(combo);

        const entry = new Adw.EntryRow({
            title: _('Custom name'),
            text: settings.get_string('custom-name'),
        });
        entry.connect('changed', () => settings.set_string('custom-name', entry.text));
        group.add(entry);

        const syncEntry = () => {
            entry.visible = settings.get_string('name-source') === 'custom';
        };
        settings.connect('changed::name-source', () => {
            syncEntry();
            const index = SOURCES.indexOf(settings.get_string('name-source'));
            if (index >= 0 && combo.selected !== index)
                combo.selected = index;
        });
        syncEntry();

        const themeGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Follows the GNOME accent color. The palette button in the panel header cycles through these.'),
        });
        const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (interfaceSettings.settings_schema.has_key('accent-color')) {
            const themeCombo = new Adw.ComboRow({
                title: _('Accent color'),
                model: Gtk.StringList.new(ACCENT_NAMES.map(n => _(n))),
                selected: Math.max(0, ACCENTS.indexOf(interfaceSettings.get_string('accent-color'))),
            });
            themeCombo.connect('notify::selected', () =>
                interfaceSettings.set_string('accent-color', ACCENTS[themeCombo.selected]));
            interfaceSettings.connect('changed::accent-color', () => {
                const index = ACCENTS.indexOf(interfaceSettings.get_string('accent-color'));
                if (index >= 0 && themeCombo.selected !== index)
                    themeCombo.selected = index;
            });
            themeGroup.add(themeCombo);
        } else {
            const themeCombo = new Adw.ComboRow({
                title: _('Color theme'),
                model: Gtk.StringList.new(['Lavender', 'Sage Green', 'Ocean Blue', 'Terracotta']),
                selected: Math.max(0, THEMES.indexOf(settings.get_string('theme'))),
            });
            themeCombo.connect('notify::selected', () =>
                settings.set_string('theme', THEMES[themeCombo.selected]));
            themeGroup.add(themeCombo);
        }

        const addSwitch = (key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle, active: settings.get_boolean(key)});
            row.connect('notify::active', () => settings.set_boolean(key, row.active));
            settings.connect(`changed::${key}`, () => {
                if (row.active !== settings.get_boolean(key))
                    row.active = settings.get_boolean(key);
            });
            themeGroup.add(row);
        };
        addSwitch('theme-shell', _('Color the shell'),
            _('Top bar, menus and notifications use the theme colors (dark mode)'));
        addSwitch('theme-apps', _('Color GTK apps'),
            _('Writes colors to ~/.config/gtk-4.0 and gtk-3.0; apps pick them up when started'));

        page.add(themeGroup);

        const qsGroup = new Adw.PreferencesGroup({
            title: _('Quick Settings'),
            description: _('The panel opened from the top bar.'),
        });
        page.add(qsGroup);
        const qsSwitch = new Adw.SwitchRow({
            title: _('Use Material 3 Quick Settings'),
            subtitle: _('Off restores GNOME\'s own panel'),
        });
        settings.bind('show-quicksettings', qsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        qsGroup.add(qsSwitch);
        const TILE_STYLES = ['classic', 'split'];
        const tileModel = new Gtk.StringList();
        tileModel.append(_('Classic: click toggles, right-click opens options'));
        tileModel.append(_('Split: icon toggles, text opens options'));
        const tileRow = new Adw.ComboRow({
            title: _('Tile style'),
            subtitle: _('In the split style only tiles that have options are divided'),
            model: tileModel,
            selected: Math.max(0, TILE_STYLES.indexOf(settings.get_string('qs-tile-style'))),
        });
        tileRow.connect('notify::selected', () =>
            settings.set_string('qs-tile-style', TILE_STYLES[tileRow.selected] ?? 'classic'));
        qsGroup.add(tileRow);

        const choiceRow = (key, title, subtitle, values, labels) => {
            const model = new Gtk.StringList();
            labels.forEach(l => model.append(l));
            const row = new Adw.ComboRow({
                title, subtitle, model,
                selected: Math.max(0, values.indexOf(settings.get_string(key))),
            });
            row.connect('notify::selected', () => settings.set_string(key, values[row.selected] ?? values[0]));
            qsGroup.add(row);
        };
        choiceRow('qs-slider-style', _('Slider style'), _('Brightness and volume sliders'),
            ['classic', 'handle'], [_('Classic: capsule with - and + buttons'), _('Handle: split track with round buttons')]);
        choiceRow('qs-media-style', _('Media player style'), _('The card that shows the playing track'),
            ['classic', 'cover'], [_('Classic: compact card'), _('Cover: album art with seek bar')]);

        const dateMenuSwitch = new Adw.SwitchRow({
            title: _('Material 3 date menu'),
            subtitle: _('Notifications, calendar, reminders, world clocks and weather in the clock menu'),
        });
        settings.bind('show-datemenu', dateMenuSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        qsGroup.add(dateMenuSwitch);
        const switcherSwitch = new Adw.SwitchRow({
            title: _('Material 3 Alt+Tab switcher'),
            subtitle: _('Off restores GNOME\'s own window switcher'),
        });
        settings.bind('show-switcher', switcherSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        qsGroup.add(switcherSwitch);

        const dockGroup = new Adw.PreferencesGroup({
            title: _('Dock and app menu'),
            description: _('The floating dock at the bottom of the screen and the app menu it opens.'),
        });
        page.add(dockGroup);
        const dockSwitch = new Adw.SwitchRow({
            title: _('Show dock'),
            active: settings.get_boolean('show-dock'),
        });
        dockSwitch.connect('notify::active', () =>
            settings.set_boolean('show-dock', dockSwitch.active));
        settings.connect('changed::show-dock', () => {
            if (dockSwitch.active !== settings.get_boolean('show-dock'))
                dockSwitch.active = settings.get_boolean('show-dock');
        });
        dockGroup.add(dockSwitch);

        const menuSwitch = new Adw.SwitchRow({
            title: _('Use Material 3 app menu'),
            subtitle: _('Off opens GNOME\'s Overview from the dock and the Super key'),
        });
        settings.bind('show-appmenu', menuSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        dockGroup.add(menuSwitch);

        const recentSwitch = new Adw.SwitchRow({
            title: _('Show recent window'),
            subtitle: _('The card at the bottom of the app menu that reopens the last used window'),
            active: settings.get_boolean('show-recent'),
        });
        recentSwitch.connect('notify::active', () =>
            settings.set_boolean('show-recent', recentSwitch.active));
        settings.connect('changed::show-recent', () => {
            if (recentSwitch.active !== settings.get_boolean('show-recent'))
                recentSwitch.active = settings.get_boolean('show-recent');
        });
        dockGroup.add(recentSwitch);

        const settingsSwitch = new Adw.SwitchRow({
            title: _('Replace GNOME Settings'),
            subtitle: _('Open the Material 3 Settings app instead of GNOME Settings (takes effect immediately)'),
            active: settings.get_boolean('show-settings'),
        });
        settingsSwitch.connect('notify::active', () =>
            settings.set_boolean('show-settings', settingsSwitch.active));
        settings.connect('changed::show-settings', () => {
            if (settingsSwitch.active !== settings.get_boolean('show-settings'))
                settingsSwitch.active = settings.get_boolean('show-settings');
        });
        dockGroup.add(settingsSwitch);

        const styleModel = new Gtk.StringList();
        const STYLES = ['cards', 'pills'];
        styleModel.append(_('Cards with colored icons'));
        styleModel.append(_('Compact pills'));
        const styleRow = new Adw.ComboRow({
            title: _('Settings sidebar buttons'),
            subtitle: _('Look of the page list in the Settings app'),
            model: styleModel,
            selected: Math.max(0, STYLES.indexOf(settings.get_string('settings-sidebar-style'))),
        });
        styleRow.connect('notify::selected', () =>
            settings.set_string('settings-sidebar-style', STYLES[styleRow.selected] ?? 'cards'));
        dockGroup.add(styleRow);

        const borderGroup = new Adw.PreferencesGroup({
            title: _('Borders and corners'),
            description: _('Border and corners of each surface, set separately. A width of 0 removes the border.'),
        });
        page.add(borderGroup);
        const COLORS = ['outline', 'primary', 'secondary', 'text'];
        const colorModel = () => {
            const model = new Gtk.StringList();
            [_('Outline'), _('Accent'), _('Secondary'), _('Text')].forEach(c => model.append(c));
            return model;
        };
        for (const [id, name] of [
            ['qs', _('Quick Settings')], ['appmenu', _('App menu')], ['dock', _('Dock')], ['ctx', _('Context menus')],
            ['settings', _('Settings app')],
        ]) {
            const expander = new Adw.ExpanderRow({title: name});
            const width = new Adw.SpinRow({
                title: _('Width'),
                adjustment: new Gtk.Adjustment({lower: 0, upper: 4, step_increment: 1,
                    value: settings.get_int(`border-${id}-width`)}),
            });
            settings.bind(`border-${id}-width`, width, 'value', Gio.SettingsBindFlags.DEFAULT);
            const radius = new Adw.SpinRow({
                title: _('Corner radius'),
                adjustment: new Gtk.Adjustment({lower: 0, upper: 48, step_increment: 2,
                    value: settings.get_int(`border-${id}-radius`)}),
            });
            settings.bind(`border-${id}-radius`, radius, 'value', Gio.SettingsBindFlags.DEFAULT);
            const color = new Adw.ComboRow({
                title: _('Color'),
                model: colorModel(),
                selected: Math.max(0, COLORS.indexOf(settings.get_string(`border-${id}-color`))),
            });
            color.connect('notify::selected', () =>
                settings.set_string(`border-${id}-color`, COLORS[color.selected] ?? 'outline'));
            expander.add_row(width);
            expander.add_row(radius);
            expander.add_row(color);
            borderGroup.add(expander);
        }

        const osdGroup = new Adw.PreferencesGroup({
            title: _('On-screen display'),
            description: _('The indicator shown when you change the volume or brightness.'),
        });
        page.add(osdGroup);
        const osdSwitch = new Adw.SwitchRow({
            title: _('Material 3 volume and brightness indicator'),
            subtitle: _('Replaces the shell\'s own on-screen display'),
            active: settings.get_boolean('osd-enabled'),
        });
        osdSwitch.connect('notify::active', () =>
            settings.set_boolean('osd-enabled', osdSwitch.active));
        settings.connect('changed::osd-enabled', () => {
            if (osdSwitch.active !== settings.get_boolean('osd-enabled'))
                osdSwitch.active = settings.get_boolean('osd-enabled');
        });
        osdGroup.add(osdSwitch);

        const MODES = ['static', 'autohide'];
        const modeRow = new Adw.ComboRow({
            title: _('Dock behavior'),
            subtitle: _('Static keeps the dock in view and stops maximized windows above it'),
            model: Gtk.StringList.new([_('Static'), _('Auto-hide')]),
            selected: Math.max(0, MODES.indexOf(settings.get_string('dock-mode'))),
        });
        modeRow.connect('notify::selected', () =>
            settings.set_string('dock-mode', MODES[modeRow.selected]));
        settings.connect('changed::dock-mode', () => {
            const index = MODES.indexOf(settings.get_string('dock-mode'));
            if (index >= 0 && modeRow.selected !== index)
                modeRow.selected = index;
        });
        dockGroup.add(modeRow);

        const addSpin = (group, key, title, subtitle, {lower, upper, step, digits, integer}) => {
            const get = () => integer ? settings.get_int(key) : settings.get_double(key);
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({
                    lower, upper, step_increment: step, page_increment: step * 4,
                    value: get(),
                }),
                digits,
            });
            row.connect('notify::value', () => {
                if (integer)
                    settings.set_int(key, Math.round(row.value));
                else
                    settings.set_double(key, row.value);
            });
            settings.connect(`changed::${key}`, () => {
                if (Math.abs(row.value - get()) > 0.001)
                    row.value = get();
            });
            group.add(row);
        };
        addSpin(dockGroup, 'dock-scale', _('Dock size'), _('1.00 is the default size'),
            {lower: 0.7, upper: 1.6, step: 0.05, digits: 2});
        addSpin(dockGroup, 'dock-margin', _('Dock height'),
            _('Gap between the dock and the bottom edge of the screen, in pixels'),
            {lower: 0, upper: 96, step: 2, digits: 0, integer: true});
        addSpin(dockGroup, 'appmenu-scale', _('App menu size'), _('1.00 is the default size'),
            {lower: 0.7, upper: 1.5, step: 0.05, digits: 2});
        addSpin(dockGroup, 'preview-scale', _('Window preview size'),
            _('Size of the preview shown when hovering a dock icon; 1.00 is the default'),
            {lower: 0.6, upper: 2.0, step: 0.05, digits: 2});
        const dockChoice = (key, title, subtitle, values, labels) => {
            const model = new Gtk.StringList();
            labels.forEach(l => model.append(l));
            const row = new Adw.ComboRow({
                title, subtitle, model,
                selected: Math.max(0, values.indexOf(settings.get_string(key))),
            });
            row.connect('notify::selected', () => settings.set_string(key, values[row.selected] ?? values[0]));
            dockGroup.add(row);
        };
        dockChoice('dock-end-button', _('Dock end button'),
            _('The button at the end of the dock'),
            ['none', 'theme', 'settings'], [_('None'), _('Theme switch'), _('Settings shortcut')]);
        dockChoice('appmenu-sort', _('App sort order'), _('Order of the apps in the app menu'),
            ['name', 'name-desc', 'usage'], [_('Name (A-Z)'), _('Name (Z-A)'), _('Most used')]);
        addSpin(dockGroup, 'appmenu-width', _('App menu width'),
            _('Width of the app menu in pixels; the app cards share it evenly'),
            {lower: 360, upper: 900, step: 10, digits: 0, integer: true});
        addSpin(dockGroup, 'appmenu-height', _('App menu height'),
            _('Height of the scrolling app grid in the app menu, in pixels'),
            {lower: 120, upper: 640, step: 10, digits: 0, integer: true});

        const sizeGroup = new Adw.PreferencesGroup({
            title: _('Size and font'),
            description: _('Scale the Quick Settings panel, dock and app menu, and choose their font. Changes apply immediately.'),
        });
        page.add(sizeGroup);

        const addScale = (key, title, subtitle, lower, upper) => {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({
                    lower, upper, step_increment: 0.05, page_increment: 0.1,
                    value: settings.get_double(key),
                }),
                digits: 2,
            });
            row.connect('notify::value', () => settings.set_double(key, row.value));
            settings.connect(`changed::${key}`, () => {
                if (Math.abs(row.value - settings.get_double(key)) > 0.001)
                    row.value = settings.get_double(key);
            });
            sizeGroup.add(row);
        };
        addScale('ui-scale', _('UI scale'), _('1.00 is the default size'), 0.75, 1.5);
        addScale('font-scale', _('Text size'), _('Extra text scale on top of the UI scale'), 0.8, 1.4);

        const fontRow = new Adw.ActionRow({
            title: _('Font'),
            subtitle: settings.get_string('font-family') || _('Default (Plus Jakarta Sans)'),
        });
        const fontButton = new Gtk.FontDialogButton({
            valign: Gtk.Align.CENTER,
            dialog: new Gtk.FontDialog(),
            level: Gtk.FontLevel.FAMILY,
            use_font: true,
        });
        const current = settings.get_string('font-family');
        if (current)
            fontButton.font_desc = Pango.FontDescription.from_string(current);
        fontButton.connect('notify::font-desc', () => {
            const family = fontButton.font_desc?.get_family() ?? '';
            if (family && family !== settings.get_string('font-family'))
                settings.set_string('font-family', family);
        });
        const resetButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Use the default font'),
            css_classes: ['flat'],
        });
        resetButton.connect('clicked', () => settings.set_string('font-family', ''));
        settings.connect('changed::font-family', () => {
            fontRow.subtitle = settings.get_string('font-family') || _('Default (Plus Jakarta Sans)');
        });
        fontRow.add_suffix(resetButton);
        fontRow.add_suffix(fontButton);
        sizeGroup.add(fontRow);

        // The right-click menus (dock icons and app menu) can use their own font.
        const ctxDefault = () => _('Same as the font above');
        const ctxRow = new Adw.ActionRow({
            title: _('Context menu font'),
            subtitle: settings.get_string('context-font-family') || ctxDefault(),
        });
        const ctxButton = new Gtk.FontDialogButton({
            valign: Gtk.Align.CENTER,
            dialog: new Gtk.FontDialog(),
            level: Gtk.FontLevel.FAMILY,
            use_font: true,
        });
        const ctxCurrent = settings.get_string('context-font-family');
        if (ctxCurrent)
            ctxButton.font_desc = Pango.FontDescription.from_string(ctxCurrent);
        ctxButton.connect('notify::font-desc', () => {
            const family = ctxButton.font_desc?.get_family() ?? '';
            if (family && family !== settings.get_string('context-font-family'))
                settings.set_string('context-font-family', family);
        });
        const ctxReset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Use the font above'),
            css_classes: ['flat'],
        });
        ctxReset.connect('clicked', () => settings.set_string('context-font-family', ''));
        settings.connect('changed::context-font-family', () => {
            ctxRow.subtitle = settings.get_string('context-font-family') || ctxDefault();
        });
        ctxRow.add_suffix(ctxReset);
        ctxRow.add_suffix(ctxButton);
        sizeGroup.add(ctxRow);
        addSpin(sizeGroup, 'context-scale', _('Context menu size'),
            _('Size of the right-click menus; 1.00 is the default'),
            {lower: 0.7, upper: 1.6, step: 0.05, digits: 2});
        addSpin(sizeGroup, 'context-font-scale', _('Context menu text size'),
            _('Size of the text in the right-click menus; 1.00 is the default'),
            {lower: 0.7, upper: 1.6, step: 0.05, digits: 2});
        const ctxIcons = new Adw.SwitchRow({
            title: _('Context menu icons'),
            subtitle: _('Show an icon before each entry of the right-click menus'),
        });
        settings.bind('context-show-icons', ctxIcons, 'active', Gio.SettingsBindFlags.DEFAULT);
        sizeGroup.add(ctxIcons);
        addSpin(sizeGroup, 'datemenu-scale', _('Date menu size'),
            _('Size of the clock menu panel; 1.00 is the default'),
            {lower: 0.7, upper: 1.5, step: 0.05, digits: 2});
        addSpin(sizeGroup, 'datemenu-font-scale', _('Date menu text size'),
            _('Size of the text in the clock menu; 1.00 is the default'),
            {lower: 0.7, upper: 1.5, step: 0.05, digits: 2});


        window.add(page);
        window.add(buildCategoriesPage(window, settings));
    }
}

/** Small flat icon button for the suffix of a row. */
function flatButton(icon, tooltip, callback, sensitive = true) {
    const button = new Gtk.Button({
        icon_name: icon,
        valign: Gtk.Align.CENTER,
        tooltip_text: tooltip,
        css_classes: ['flat'],
        sensitive,
    });
    button.connect('clicked', callback);
    return button;
}

/**
 * The "App menu" page: favorite category mode, plus the order, visibility
 * and contents of the category pills (built-in and custom).
 *
 * @param {Adw.PreferencesWindow} window
 * @param {Gio.Settings} settings
 * @returns {Adw.PreferencesPage}
 */
function buildCategoriesPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('App menu'),
        icon_name: 'view-app-grid-symbolic',
    });

    // Favorite category -------------------------------------------------
    const favGroup = new Adw.PreferencesGroup({
        title: _('Favorite category'),
        description: _('Opens the app menu on one category and reads only its apps, so the first open stays light. Other categories are read the first time you select them.'),
    });
    page.add(favGroup);

    const favSwitch = new Adw.SwitchRow({
        title: _('Load only the favorite category'),
        active: settings.get_boolean('favorite-category-enabled'),
    });
    favGroup.add(favSwitch);

    const favCombo = new Adw.ComboRow({
        title: _('Favorite category'),
        subtitle: _('The category the app menu opens on'),
        model: Gtk.StringList.new([]),
        sensitive: favSwitch.active,
    });
    favGroup.add(favCombo);

    let favIds = [];
    let syncing = false;
    favSwitch.connect('notify::active', () => {
        settings.set_boolean('favorite-category-enabled', favSwitch.active);
        favCombo.sensitive = favSwitch.active;
    });
    settings.connect('changed::favorite-category-enabled', () => {
        const on = settings.get_boolean('favorite-category-enabled');
        if (favSwitch.active !== on)
            favSwitch.active = on;
    });
    favCombo.connect('notify::selected', () => {
        if (syncing || favCombo.selected >= favIds.length)
            return;
        settings.set_string('favorite-category', favIds[favCombo.selected]);
    });

    // Categories --------------------------------------------------------
    const catGroup = new Adw.PreferencesGroup({
        title: _('Categories'),
        description: _('Reorder the pills with the arrows, hide the ones you do not need, or add your own. Apps in a custom category also stay in their built-in one.'),
    });
    page.add(catGroup);

    const addButton = new Gtk.Button({
        label: _('Add category'),
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    catGroup.set_header_suffix(addButton);

    let rows = [];
    const saveCustom = custom =>
        settings.set_string('custom-categories', serializeCustom(custom));

    let refreshQueued = false;
    const queueRefresh = () => {
        if (refreshQueued)
            return;
        refreshQueued = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            refreshQueued = false;
            refresh();
            return GLib.SOURCE_REMOVE;
        });
    };

    const askName = (heading, initial, onDone) => {
        const dialog = new Adw.AlertDialog({
            heading,
            body: _('Choose a short name; it is shown on the category pill.'),
        });
        const entry = new Gtk.Entry({
            text: initial,
            max_length: 24,
            activates_default: true,
        });
        dialog.set_extra_child(entry);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('save', _('Save'));
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('save');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            const name = entry.text.trim();
            if (response === 'save' && name)
                onDone(name);
        });
        dialog.present(window);
        entry.grab_focus();
    };

    const chooseApps = cat => {
        const selected = new Set(cat.apps);
        const dialog = new Adw.Dialog({
            title: cat.label,
            content_width: 440,
            content_height: 580,
        });
        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(new Adw.HeaderBar());

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        const search = new Gtk.SearchEntry({placeholder_text: _('Search apps')});
        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        const scroll = new Gtk.ScrolledWindow({
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            child: list,
        });
        box.append(search);
        box.append(scroll);
        toolbar.set_content(box);
        dialog.set_child(toolbar);

        const infos = Gio.AppInfo.get_all()
            .filter(info => info.should_show() && info.get_id())
            .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
        for (const info of infos) {
            const id = info.get_id();
            const row = new Adw.ActionRow({
                title: info.get_display_name(),
                use_markup: false,
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({gicon: info.get_icon(), pixel_size: 32}));
            const check = new Gtk.CheckButton({
                active: selected.has(id),
                valign: Gtk.Align.CENTER,
            });
            check.connect('toggled', () => {
                if (check.active)
                    selected.add(id);
                else
                    selected.delete(id);
            });
            row.add_suffix(check);
            row.set_activatable_widget(check);
            list.append(row);
        }

        list.set_filter_func(row => {
            const query = search.text.trim().toLowerCase();
            return !query || row.title.toLowerCase().includes(query);
        });
        search.connect('search-changed', () => list.invalidate_filter());

        dialog.connect('closed', () => {
            const {custom} = orderedCategories(settings);
            const target = custom.find(c => c.id === cat.id);
            if (!target)
                return;
            target.apps = [...selected];
            saveCustom(custom);
            queueRefresh();
        });
        dialog.present(window);
    };

    const deleteCategory = cat => {
        const dialog = new Adw.AlertDialog({
            heading: `${_('Delete category')} \u201c${cat.label}\u201d?`,
            body: _('The apps themselves are not removed.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('delete', _('Delete'));
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'delete')
                return;
            const {custom} = orderedCategories(settings);
            saveCustom(custom.filter(c => c.id !== cat.id));
            settings.set_strv('category-order',
                settings.get_strv('category-order').filter(id => id !== cat.id));
            settings.set_strv('hidden-categories',
                settings.get_strv('hidden-categories').filter(id => id !== cat.id));
            if (settings.get_string('favorite-category') === cat.id)
                settings.set_string('favorite-category', '');
            queueRefresh();
        });
        dialog.present(window);
    };

    const makeRow = (cat, index, ordered) => {
        const subtitle = cat.id === 'all'
            ? _('Every app')
            : cat.builtin
                ? _('Built-in')
                : `${cat.apps.length} ${_('apps')}`;
        const row = new Adw.ActionRow({
            title: cat.label,
            subtitle,
            use_markup: false,
            opacity: cat.hidden ? 0.5 : 1,
        });

        const move = to => {
            const ids = ordered.map(c => c.id);
            const [id] = ids.splice(index, 1);
            ids.splice(to, 0, id);
            settings.set_strv('category-order', ids);
            queueRefresh();
        };

        if (!cat.builtin) {
            row.add_suffix(flatButton('view-list-symbolic', _('Choose apps'),
                () => chooseApps(cat)));
            row.add_suffix(flatButton('document-edit-symbolic', _('Rename'),
                () => askName(_('Rename category'), cat.label, name => {
                    const {custom} = orderedCategories(settings);
                    const target = custom.find(c => c.id === cat.id);
                    if (target) {
                        target.label = name;
                        saveCustom(custom);
                        queueRefresh();
                    }
                })));
            row.add_suffix(flatButton('user-trash-symbolic', _('Delete'),
                () => deleteCategory(cat)));
        }

        if (cat.id !== 'all') {
            const visible = new Gtk.Switch({
                active: !cat.hidden,
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Show in the app menu'),
            });
            visible.connect('notify::active', () => {
                const hidden = new Set(settings.get_strv('hidden-categories'));
                if (visible.active)
                    hidden.delete(cat.id);
                else
                    hidden.add(cat.id);
                settings.set_strv('hidden-categories', [...hidden]);
                queueRefresh();
            });
            row.add_suffix(visible);
        }

        row.add_suffix(flatButton('go-up-symbolic', _('Move earlier'),
            () => move(index - 1), index > 0));
        row.add_suffix(flatButton('go-down-symbolic', _('Move later'),
            () => move(index + 1), index < ordered.length - 1));
        return row;
    };

    const refresh = () => {
        const {ordered} = orderedCategories(settings, _);

        for (const row of rows)
            catGroup.remove(row);
        rows = ordered.map((cat, index) => makeRow(cat, index, ordered));
        for (const row of rows)
            catGroup.add(row);

        // The favorite can be any visible category except "Semua".
        const candidates = ordered.filter(c => c.id !== 'all' && !c.hidden);
        favIds = candidates.map(c => c.id);
        syncing = true;
        favCombo.model = Gtk.StringList.new(candidates.map(c => c.label));
        const current = favIds.indexOf(settings.get_string('favorite-category'));
        favCombo.selected = Math.max(0, current);
        syncing = false;
        if (current < 0 && favIds.length > 0)
            settings.set_string('favorite-category', favIds[0]);
    };

    addButton.connect('clicked', () => askName(_('New category'), '', name => {
        const {custom} = orderedCategories(settings);
        const cat = {
            id: `c${Date.now().toString(36)}`,
            label: name,
            apps: [],
            builtin: false,
        };
        custom.push(cat);
        saveCustom(custom);
        refresh();
        chooseApps(cat);
    }));

    refresh();
    return page;
}
