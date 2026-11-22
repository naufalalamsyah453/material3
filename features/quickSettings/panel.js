import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {bordersCss} from './borders.js';
import {_} from '../../i18n.js';

import {BluetoothBackend} from './backends/bluetooth.js';
import {BRIGHTNESS_MIN, BrightnessBackend} from './backends/brightness.js';
import {MediaBackend} from './backends/mpris.js';
import {WifiBackend} from './backends/network.js';
import {PowerBackend} from './backends/power.js';
import {DarkStyleBackend, DoNotDisturbBackend, NightLightBackend} from './backends/settings.js';
import {VolumeBackend} from './backends/volume.js';
import {DetailPane} from './detail.js';
import {buildMediaCard} from './media.js';
import {buildSliderGroup} from './slider.js';
import {buildTileGrid} from './tiles.js';
import {ShellTheme} from './shellTheme.js';
import {openSettings} from '../settings/launcher.js';
import {THEME_NAMES, THEME_ORDER, cycleThemeKey, themeKeyFor, themedCss} from './themes.js';
import {loadUi, px, ui} from './ui.js';
import {iconButton, textLabel, truncatedLabel} from './widgets.js';

const CONTENT_WIDTH = 328;
const CACHE_DIR = 'material3';
const COLOR_SCHEME_SCHEMA = 'org.gnome.desktop.interface';

/**
 * Root of the Quick Settings surface: the content and the option pane share
 * the same origin, but only the content decides how big the root is. The
 * pane overhangs the content (to cover the panel's padding) without ever
 * making the panel taller.
 */
const StackRoot = GObject.registerClass(
class M3StackRoot extends St.Widget {
    vfunc_get_preferred_width(_forHeight) {
        return [px(CONTENT_WIDTH), px(CONTENT_WIDTH)];
    }

    vfunc_get_preferred_height(forWidth) {
        return this._m3Content?.get_preferred_height(forWidth) ?? [0, 0];
    }
});

/** Stand-in when a backend cannot start, so the UI degrades instead of failing. */
class InertBackend {
    get value() {
        return 0;
    }

    get state() {
        return {
            active: false,
            available: false,
            playing: false,
            subtitle: _('Unavailable'),
            title: _('Unavailable'),
        };
    }

    subscribe() {
        return () => {};
    }

    setValue() {}
    toggle() {}
    playPause() {}
    next() {}
    previous() {}
    destroy() {}
}

/**
 * Injects the Material 3 Quick Settings surface into the stock menu grid.
 * The stock menu (and its popup/boxpointer behaviour) is kept so panel
 * integration, keyboard handling and animations stay intact.
 */
export class QuickSettingsPanel {
    /**
     * @param {Gio.Settings} extensionSettings the extension's own settings
     * @param {Gio.File} extensionDir the extension directory
     */
    constructor(extensionSettings, extensionDir) {
        this._extSettings = extensionSettings;
        this._dir = extensionDir;
        this._themeFile = null;
        this._flashId = 0;
    }

    enable() {
        const quickSettings = Main.panel.statusArea.quickSettings;
        const menu = quickSettings?.menu;

        if (!menu?._grid) {
            console.error('material3: stock Quick Settings menu not available');
            return;
        }

        this._menu = menu;
        this._grid = menu._grid;

        this._settings = new Gio.Settings({schema_id: COLOR_SCHEME_SCHEMA});
        this._hiddenVisibility = new Map();
        this._visibilityIds = new Map();

        loadUi(this._extSettings);
        this._backends = this._createBackends();
        this._root = this._buildRoot();

        this._originalColumns = this._grid.layout_manager.n_columns;
        this._grid.layout_manager.n_columns = 1;
        this._grid.add_child(this._root);
        this._grid.layout_manager.child_set_property(
            this._grid, this._root, 'column-span', 1);

        this._childAddedId = this._grid.connect('child-added', (_grid, child) => {
            if (child !== this._root)
                this._hideActor(child);
        });

        this._hideStockItems();

        this._menu.box.add_style_class_name('m3-qs');
        this._syncTheme();

        this._colorSchemeId = this._settings.connect(
            'changed::color-scheme', () => {
                this._syncTheme();
                const key = this._themeKey();
                if (THEME_ORDER.includes(key)) {
                    this._shellTheme?.apply(key,
                        this._settings.get_string('color-scheme') === 'prefer-dark');
                }
            });

        this._nameChangedId = this._extSettings.connect('changed', (_s, key) => {
            if (key === 'theme')
                this._applyTheme();
            else if (key === 'ui-scale' || key === 'font-scale' || key === 'font-family' ||
                key === 'dock-scale' || key === 'appmenu-scale' ||
                key === 'context-font-family' || key === 'qs-tile-style' ||
                key === 'qs-slider-style' || key === 'qs-media-style' ||
                key === 'context-scale' || key === 'context-font-scale' || key === 'context-show-icons')
                this._scheduleRetune();
            else if (key === 'theme-shell' || key === 'theme-apps' || key === 'disable-shadows' ||
                key.startsWith('border-qs-') || key.startsWith('border-appmenu-') || key.startsWith('border-dock-') ||
                key.startsWith('border-ctx-'))
                this._applyTheme();
            else if (!this._flashId)
                this._syncName();
        });
        // The shell rebuilds its theme (dropping our layered stylesheet) on
        // accent changes, so put the palette back whenever the theme is swapped.
        this._shellThemeId = St.ThemeContext.get_for_stage(global.stage)
            .connect('notify::theme', () => {
                this._themeFile = null;
                this._reapplyId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._reapplyId = 0;
                    if (this._menu)
                        this._applyTheme();
                    return GLib.SOURCE_REMOVE;
                });
            });
        this._shellTheme = new ShellTheme(this._extSettings);
        this._accentId = this._settings.settings_schema.has_key('accent-color')
            ? this._settings.connect('changed::accent-color', () => this._applyTheme())
            : 0;
        this._applyTheme();

        this._openStateId = this._menu.connect('open-state-changed', (_menu, open) => {
            if (!open) {
                this._detail?.close(false);
                return;
            }
            this._syncTheme();
            this._hideStockItems();
            this._syncControls();
        });
    }

    disable() {
        // The lock screen disables extensions briefly: keep the apps' colors then.
        this._shellTheme?.destroy(Main.sessionMode.currentMode !== 'unlock-dialog');
        this._shellTheme = null;
        if (this._colorSchemeId)
            this._settings.disconnect(this._colorSchemeId);
        if (this._shellThemeId)
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._shellThemeId);
        this._shellThemeId = 0;
        if (this._reapplyId)
            GLib.source_remove(this._reapplyId);
        this._reapplyId = 0;
        if (this._retuneId)
            GLib.source_remove(this._retuneId);
        this._retuneId = 0;
        if (this._accentId)
            this._settings.disconnect(this._accentId);
        this._accentId = 0;
        if (this._nameChangedId)
            this._extSettings.disconnect(this._nameChangedId);
        this._nameChangedId = 0;
        if (this._openStateId)
            this._menu.disconnect(this._openStateId);
        if (this._childAddedId)
            this._grid.disconnect(this._childAddedId);

        this._settings?.run_dispose();

        if (this._flashId)
            GLib.source_remove(this._flashId);
        this._flashId = 0;

        if (this._themeFile) {
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()
                    .unload_stylesheet(this._themeFile);
            } catch {
                // Already unloaded.
            }
            this._themeFile = null;
        }

        this._detail = null;
        this._root?.destroy();
        this._root = null;

        for (const backend of Object.values(this._backends ?? {}))
            backend.destroy();
        this._backends = null;
        this._sliders = [];
        this._tiles = [];

        this._grid.layout_manager.n_columns = this._originalColumns ?? 2;

        for (const [actor, id] of this._visibilityIds ?? []) {
            try {
                actor.disconnect(id);
            } catch {
                // Actor already destroyed.
            }
        }
        this._visibilityIds = new Map();

        for (const [actor, wasVisible] of this._hiddenVisibility ?? [])
            actor.visible = wasVisible;

        this._menu.box.remove_style_class_name('m3-qs');
        this._menu.box.remove_style_class_name('m3-light');
        this._menu.box.remove_style_class_name('m3-dark');

        this._menu = null;
        this._grid = null;
        this._hiddenVisibility = new Map();
        this._colorSchemeId = 0;
        this._openStateId = 0;
        this._childAddedId = 0;
    }

    _buildRoot() {
        // Both children sit at (0, 0): the regular content plus the option pane
        // laid over all of it. FixedLayout (not BinLayout) so the pane's
        // position is exact and never centered/aligned by the layout.
        const root = new StackRoot({
            style_class: 'm3-qs-root',
            layout_manager: new Clutter.FixedLayout(),
        });
        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: px(CONTENT_WIDTH),
        });
        root._m3Content = content;
        root.add_child(content);

        content.add_child(this._buildHeader());

        const b = this._backends;

        const extStyle = key => (this._extSettings.settings_schema.has_key(key) ? this._extSettings.get_string(key) : 'classic');
        const sliderGroup = buildSliderGroup([
            {
                min: BRIGHTNESS_MIN,
                max: 100,
                backend: b.brightness,
                iconFor: v => v < 55 ? 'brightness_low' : v < 85 ? 'brightness_medium' : 'brightness_high',
            },
            {
                min: 0,
                max: 100,
                backend: b.volume,
                iconFor: v => v === 0 ? 'volume_off' : v < 50 ? 'volume_down' : 'volume_up',
                trailing: [
                    {iconFor: v => (v === 0 || b.volume.muted ? 'volume_off' : 'volume_up'), onClick: () => b.volume.toggleMute()},
                ],
            },
        ], {style: extStyle('qs-slider-style')});
        this._sliders = sliderGroup.sliders;
        content.add_child(sliderGroup.actor);

        const tileGroup = buildTileGrid([
            {icon: 'wifi', filledIcon: true, title: _('Wi-Fi'), backend: b.wifi, onSecondary: this._secondary(b.wifi)},
            {icon: 'bluetooth', filledIcon: true, title: _('Bluetooth'), backend: b.bluetooth, onSecondary: this._secondary(b.bluetooth)},
            {icon: 'dark_mode', title: _('Dark Style'), backend: b.dark},
            {icon: 'do_not_disturb_on', title: _('Do Not Disturb'), backend: b.dnd},
            {icon: 'nightlight', title: _('Night Light'), backend: b.night},
            {icon: 'battery_saver', title: _('Power Mode'), backend: b.power, onSecondary: this._secondary(b.power)},
        ], {
            split: this._extSettings.settings_schema.has_key('qs-tile-style') &&
                this._extSettings.get_string('qs-tile-style') === 'split',
        });
        this._tiles = tileGroup.tiles;

        content.add_child(tileGroup.actor);
        content.add_child(buildMediaCard(b.media, {style: extStyle('qs-media-style')}).actor);

        // The pane covers the whole Quick Settings surface (header to media).
        this._detail = new DetailPane({
            // Natural size, not the allocation: the allocation can include
            // space the pane itself caused, which made the panel grow on
            // every re-render.
            getSize: () => {
                const [, width] = content.get_preferred_width(-1);
                const [, height] = content.get_preferred_height(width);
                return {width, height};
            },
        });
        // The pane sits directly in the root at (-OUTSET, -OUTSET); see DetailPane._fit().
        root.add_child(this._detail.actor);

        return root;
    }

    /** Option pane for the header's power button. */
    _powerProvider() {
        // gnome-session asks the shell for the usual confirmation dialog.
        const call = (method, params) => {
            this._menu.close();
            Gio.DBus.session.call(
                'org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', method, params, null,
                Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                    try {
                        conn.call_finish(res);
                    } catch (e) {
                        console.error(`material3: ${method} failed: ${e.message}`);
                    }
                });
        };
        const items = [
            {id: 'shutdown', icon: 'power_settings_new', label: _('Shut Down'),
                activate: () => call('Shutdown', null)},
            {id: 'restart', icon: 'restart_alt', label: _('Restart'),
                activate: () => call('Reboot', null)},
            {id: 'logout', icon: 'logout', label: _('Log Out'),
                activate: () => call('Logout', new GLib.Variant('(u)', [0]))},
        ];
        return {
            title: _('Power'),
            icon: 'power_settings_new',
            fitContent: true,
            getOptions: () => ({items}),
            subscribe: () => () => {},
        };
    }

    /** Right-click handler that opens the backend's option pane, if it has one. */
    _secondary(backend) {
        const provider = backend.options;
        if (!provider)
            return null;
        return () => {
            if (this._detail.isOpen)
                this._detail.close(false);
            this._detail.open(provider);
        };
    }

    _createBackends() {
        const created = {};
        const make = (name, factory) => {
            try {
                created[name] = factory();
            } catch (e) {
                console.error(`material3: ${name} backend failed: ${e.message}`);
                created[name] = new InertBackend();
            }
        };

        make('brightness', () => new BrightnessBackend());
        make('volume', () => new VolumeBackend());
        make('wifi', () => new WifiBackend());
        make('bluetooth', () => new BluetoothBackend());
        make('dark', () => new DarkStyleBackend());
        make('dnd', () => new DoNotDisturbBackend());
        make('night', () => new NightLightBackend());
        make('power', () => new PowerBackend());
        make('media', () => new MediaBackend());
        return created;
    }

    _syncControls() {
        for (const slider of this._sliders ?? [])
            slider.sync();
        for (const tile of this._tiles ?? [])
            tile.sync();
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'm3-header',
            height: px(36),
        });

        const identity = new St.BoxLayout({
            x_expand: true,
            style: `spacing: ${px(10)}px;`,
        });

        const avatar = new St.Bin({
            style_class: 'm3-avatar',
            width: px(36),
            height: px(36),
            child: textLabel('', 'm3-avatar-initial'),
        });
        this._avatarInitial = avatar.get_child();
        this._avatarInitial.x_align = Clutter.ActorAlign.CENTER;
        this._avatarInitial.y_align = Clutter.ActorAlign.CENTER;
        identity.add_child(avatar);

        this._nameLabel = truncatedLabel('', 'm3-header-name', 128);
        this._nameLabel.y_align = Clutter.ActorAlign.CENTER;
        identity.add_child(this._nameLabel);
        this._syncName();

        header.add_child(identity);

        const actions = new St.BoxLayout({
            style: `spacing: ${px(6)}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const themeButton = iconButton('palette', {size: 19});
        themeButton.connect('clicked', () => this._cycleTheme());
        actions.add_child(themeButton);

        const settings = iconButton('settings', {size: 19});
        settings.connect('clicked', () => {
            this._menu.close();
            try {
                openSettings();
            } catch (e) {
                console.error(`material3: failed to launch settings: ${e}`);
            }
        });
        actions.add_child(settings);

        const power = iconButton('power_settings_new', {size: 19});
        power.connect('clicked', () => {
            if (this._detail.isOpen)
                this._detail.close(false);
            this._detail.open(this._powerProvider());
        });
        actions.add_child(power);

        header.add_child(actions);

        return header;
    }

    /** Name from the extension settings: account, login, host or custom. */
    _displayName() {
        const source = this._extSettings.get_string('name-source');
        let name = '';

        if (source === 'custom')
            name = this._extSettings.get_string('custom-name');
        else if (source === 'username')
            name = GLib.get_user_name();
        else if (source === 'hostname')
            name = GLib.get_host_name();
        else
            name = GLib.get_real_name();

        name = name?.trim();
        // GLib reports "Unknown" when the account has no full name.
        if (!name || (source === 'real-name' && name === 'Unknown'))
            name = GLib.get_user_name();
        return name;
    }

    /** Active palette: the GNOME accent color, or the extension's own setting without one. */
    _themeKey() {
        return themeKeyFor(this._settings, this._extSettings);
    }

    _cycleTheme() {
        const next = cycleThemeKey(this._settings, this._extSettings);
        this._flashHeader(_('Theme: %s').format(_(THEME_NAMES[next])));
    }

    /** Briefly show a message where the name is (the HTML's theme toast). */
    _flashHeader(text) {
        if (this._flashId)
            GLib.source_remove(this._flashId);
        this._nameLabel?.set_text(text);
        this._flashId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._flashId = 0;
            this._syncName();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Apply the selected palette. Lavender is the base stylesheet; the other
     * themes are the same stylesheet re-colored and layered on top.
     */
    _applyTheme() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

        if (this._themeFile) {
            try {
                theme.unload_stylesheet(this._themeFile);
            } catch {
                // Not loaded any more.
            }
            this._themeFile = null;
        }

        const key = this._themeKey();
        if (THEME_ORDER.includes(key)) {
            try {
                const [, bytes] = this._dir.get_child('stylesheet.css').load_contents(null);
                let css = themedCss(new TextDecoder().decode(bytes), key, ui) +
                    bordersCss(this._extSettings, key);
                // One switch for every surface of the extension: panels, menus,
                // dock, switcher, date menu. Text shadows stay, they keep
                // labels on the wallpaper readable.
                if (this._extSettings.settings_schema.has_key('disable-shadows') &&
                    this._extSettings.get_boolean('disable-shadows'))
                    css = css.replace(/box-shadow\s*:[^;}]*/g, 'box-shadow: none');

                const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_DIR]);
                GLib.mkdir_with_parents(dir, 0o755);
                const file = Gio.File.new_for_path(GLib.build_filenamev([
                    dir, `theme-${key}-${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, css, -1).slice(0, 8)}.css`]));
                file.replace_contents(new TextEncoder().encode(css), null, false,
                    Gio.FileCreateFlags.NONE, null);

                theme.load_stylesheet(file);
                this._themeFile = file;
            } catch (e) {
                console.error(`material3: failed to apply theme "${key}": ${e.message}`);
            }
        }

        // The shell's own chrome and GTK apps follow the same palette.
        if (THEME_ORDER.includes(key)) {
            this._shellTheme?.apply(key,
                this._settings.get_string('color-scheme') === 'prefer-dark');
        }

        this._syncTiles();
    }

    /** Debounced: the settings window emits many changes while a value is dragged. */
    _scheduleRetune() {
        if (this._retuneId)
            GLib.source_remove(this._retuneId);
        this._retuneId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._retuneId = 0;
            if (this._menu)
                this._retune();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** New scale/font: rebuild the widgets (their pixel sizes) and the stylesheet layer. */
    _retune() {
        loadUi(this._extSettings);
        this._detail?.close(false);
        this._detail = null;
        this._root?.destroy();

        this._root = this._buildRoot();
        this._grid.add_child(this._root);
        this._grid.layout_manager.child_set_property(
            this._grid, this._root, 'column-span', 1);
        this._hideStockItems();

        this._applyTheme();
        this._syncControls();
    }

    _syncTiles() {
        const key = this._themeKey();
        const dark = this._settings.get_string('color-scheme') === 'prefer-dark';
        for (const tile of this._tiles ?? [])
            tile.setAppearance(key, dark);
    }

    _syncName() {
        const name = this._displayName();
        this._nameLabel?.set_text(name);
        this._avatarInitial?.set_text(
            (Array.from(name)[0] ?? '?').toLocaleUpperCase());
    }

    _hideStockItems() {
        if (!this._grid)
            return;

        for (const actor of this._grid.get_children()) {
            if (actor === this._root)
                continue;
            this._hideActor(actor);
        }
    }

    /**
     * Hide a stock item and keep it hidden. Stock toggles flip their own
     * `visible` whenever their state changes (Wi-Fi, Bluetooth, power,
     * airplane mode...), so a single hide() is not enough: remember what the
     * stock code wanted, then re-hide on every change.
     */
    _hideActor(actor) {
        if (!this._hiddenVisibility.has(actor)) {
            this._hiddenVisibility.set(actor, actor.visible);
            const id = actor.connect('notify::visible', () => {
                if (!actor.visible)
                    return;
                this._hiddenVisibility.set(actor, true);
                actor.hide();
            });
            this._visibilityIds.set(actor, id);
        }
        actor.hide();
    }

    _syncTheme() {
        const isDark =
            this._settings.get_string('color-scheme') === 'prefer-dark';
        const box = this._menu.box;

        box.remove_style_class_name('m3-light');
        box.remove_style_class_name('m3-dark');
        box.add_style_class_name(isDark ? 'm3-dark' : 'm3-light');

        this._syncTiles();
    }
}
