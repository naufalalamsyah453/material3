import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {orderedCategories, serializeCustom} from './features/dock/categories.js';
import {BORDER_COLORS, componentSpec, globalSpec} from './componentSpec.js';

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

        page.add(themeGroup);

        // General: settings that belong to no single component.
        const generalGroup = new Adw.PreferencesGroup({
            title: _('Look and feel'),
            description: _('Apply to every part of the extension.'),
        });
        page.add(generalGroup);
        for (const spec of globalSpec(_))
            generalGroup.add(this._row(settings, spec));
        window.add(page);

        // One page per area; a component is a group with its switch, sizes and border.
        const byId = Object.fromEntries(componentSpec(_).map(c => [c.id, c]));
        const pages = [
            ['qs', _('Quick Settings'), 'preferences-system-symbolic', ['qs']],
            ['dock', _('Dock'), 'view-app-grid-symbolic', ['dock']],
            ['appmenu', _('App menu'), 'view-list-symbolic', ['appmenu']],
            ['menus', _('Menus'), 'view-more-symbolic', ['ctx', 'datemenu']],
            ['windows', _('Windows and screen'), 'video-display-symbolic', ['switcher', 'osd', 'prompt', 'desktop']],
            ['system', _('Settings app'), 'emblem-system-symbolic', ['settings']],
        ];
        for (const [id, title, icon, components] of pages) {
            const componentPage = new Adw.PreferencesPage({title, icon_name: icon});
            for (const key of components)
                componentPage.add(this._componentGroup(settings, byId[key]));
            window.add(componentPage);
            // The app menu keeps its categories editor right after its own page.
            if (id === 'appmenu')
                window.add(buildCategoriesPage(window, settings));
        }
    }

    /** One row of a component spec, bound to its key. */
    _row(settings, spec) {
        const key = spec.key;
        if (!settings.settings_schema.has_key(key))
            return new Adw.ActionRow({title: spec.title, subtitle: _('Not available'), sensitive: false});

        if (spec.k === 'switch') {
            const row = new Adw.SwitchRow({title: spec.title, subtitle: spec.sub ?? ''});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        }
        if (spec.k === 'choice') {
            const row = new Adw.ComboRow({
                title: spec.title, subtitle: spec.sub ?? '',
                model: Gtk.StringList.new(spec.labels),
                selected: Math.max(0, spec.values.indexOf(settings.get_string(key))),
            });
            row.connect('notify::selected', () =>
                settings.set_string(key, spec.values[row.selected] ?? spec.values[0]));
            settings.connect(`changed::${key}`, () => {
                const index = spec.values.indexOf(settings.get_string(key));
                if (index >= 0 && row.selected !== index)
                    row.selected = index;
            });
            return row;
        }
        if (spec.k === 'num') {
            const get = () => spec.integer ? settings.get_int(key) : settings.get_double(key);
            const row = new Adw.SpinRow({
                title: spec.title, subtitle: spec.sub ?? '', digits: spec.digits,
                adjustment: new Gtk.Adjustment({
                    lower: spec.min, upper: spec.max, step_increment: spec.step,
                    page_increment: spec.step * 4, value: get(),
                }),
            });
            row.connect('notify::value', () => {
                if (spec.integer)
                    settings.set_int(key, Math.round(row.value));
                else
                    settings.set_double(key, row.value);
            });
            settings.connect(`changed::${key}`, () => {
                if (Math.abs(row.value - get()) > 0.001)
                    row.value = get();
            });
            return row;
        }
        // font
        const row = new Adw.ActionRow({title: spec.title, subtitle: settings.get_string(key) || spec.fallback});
        const button = new Gtk.FontDialogButton({
            valign: Gtk.Align.CENTER, dialog: new Gtk.FontDialog(), level: Gtk.FontLevel.FAMILY, use_font: true,
        });
        const current = settings.get_string(key);
        if (current)
            button.font_desc = Pango.FontDescription.from_string(current);
        button.connect('notify::font-desc', () => {
            const family = button.font_desc?.get_family() ?? '';
            if (family && family !== settings.get_string(key))
                settings.set_string(key, family);
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, tooltip_text: spec.reset, css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.set_string(key, ''));
        settings.connect(`changed::${key}`, () => {
            row.subtitle = settings.get_string(key) || spec.fallback;
        });
        row.add_suffix(reset);
        row.add_suffix(button);
        return row;
    }

    /** A component: its on/off switch, its own settings, then width, radius and color of its border. */
    _componentGroup(settings, component) {
        const group = new Adw.PreferencesGroup({title: component.title, description: component.sub});
        const rows = [];
        if (component.toggle) {
            const toggle = this._row(settings, {k: 'switch', ...component.toggle});
            group.add(toggle);
        }
        for (const spec of component.rows) {
            const row = this._row(settings, spec);
            rows.push(row);
            group.add(row);
        }
        if (component.border) {
            const id = component.border;
            const expander = new Adw.ExpanderRow({
                title: component.borderTitle ?? _('Border and corners'),
                subtitle: _('A width of 0 removes the border'),
            });
            expander.add_row(this._row(settings, {k: 'num', key: `border-${id}-width`, title: _('Width'),
                min: 0, max: 4, step: 1, digits: 0, integer: true}));
            expander.add_row(this._row(settings, {k: 'num', key: `border-${id}-radius`, title: _('Corner radius'),
                min: 0, max: 48, step: 2, digits: 0, integer: true}));
            expander.add_row(this._row(settings, {k: 'choice', key: `border-${id}-color`, title: _('Color'),
                values: BORDER_COLORS, labels: [_('Outline'), _('Accent'), _('Secondary'), _('Text')]}));
            group.add(expander);
        }
        // The rows below the switch follow it: nothing to adjust while the component is off.
        if (component.toggle && settings.settings_schema.has_key(component.toggle.key)) {
            const follow = () => {
                const on = settings.get_boolean(component.toggle.key);
                rows.forEach(row => (row.sensitive = on));
            };
            settings.connect(`changed::${component.toggle.key}`, follow);
            follow();
        }
        return group;
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
