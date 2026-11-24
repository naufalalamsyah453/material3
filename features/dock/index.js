import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {_} from '../../i18n.js';

import {THEME_NAMES, cycleThemeKey, themeKeyFor} from '../quickSettings/themes.js';
import {loadUi, px} from '../quickSettings/ui.js';
import {AppMenu} from './appMenu.js';
import {readCategoryConfig} from './categories.js';
import {ContextMenu, appContextItems} from './contextMenu.js';
import {WindowPreview} from './preview.js';
import {onSettingsState} from '../settings/launcher.js';
import {PowerBackend} from '../quickSettings/backends/power.js';
import {Dock} from './dock.js';

const COLOR_SCHEME_SCHEMA = 'org.gnome.desktop.interface';
const HIDE_DELAY = 450; // ms the pointer may be away before an auto-hidden dock slides down
const REBUILD_KEYS = [
    'ui-scale', 'font-scale', 'font-family', 'dock-scale', 'appmenu-scale',
    'dock-mode', 'dock-margin', 'appmenu-height', 'appmenu-width', 'context-font-family',
    'context-scale', 'context-font-scale', 'context-show-icons', 'dock-end-button',
];
const MENU_GAP = 8; // reference: drawer bottom 84px over a 64px dock at 12px

/**
 * Bottom floating dock and the app menu it opens (the reference HTML's
 * footer and app drawer). Follows the same palette, light/dark mode and UI
 * scale as the Quick Settings panel.
 */
export class DockFeature {
    /**
     * @param {Gio.Settings} extSettings the extension's own settings
     */
    constructor(extSettings) {
        this._extSettings = extSettings;
        this._connections = [];
        this._timeouts = new Set();
        this._built = false;
    }

    enable() {
        this._iface = new Gio.Settings({schema_id: COLOR_SCHEME_SCHEMA});

        this._on(this._extSettings, 'changed', (_s, key) => {
            if (key === 'show-dock' || key === 'show-appmenu') {
                this._apply();
                this._syncDockVisibility();
            }
            else if (key === 'theme')
                this._syncThemeName();
            else if (REBUILD_KEYS.includes(key))
                this._scheduleRebuild();
        });
        this._on(this._iface, 'changed::color-scheme', () => this._syncMode());
        if (this._iface.settings_schema.has_key('accent-color'))
            this._on(this._iface, 'changed::accent-color', () => this._syncThemeName());

        this._suppressStartupOverview();
        this._apply();
    }

    disable() {
        this._restoreStartupOverview();
        this._teardown();
        for (const [object, id] of this._connections)
            object.disconnect(id);
        this._connections = [];
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._iface?.run_dispose();
        this._iface = null;
    }

    /**
     * GNOME opens the Overview after login (with its own dash). The dock
     * replaces that, so skip the Overview while the session is starting up.
     */
    _suppressStartupOverview() {
        if (!Main.layoutManager._startingUp)
            return;

        this._hadOverview = Main.sessionMode.hasOverview;
        Main.sessionMode.hasOverview = false;
        this._startupId = Main.layoutManager.connect('startup-complete', () => {
            this._restoreStartupOverview();
            this._reposition();
            this._syncMode();
        });
    }

    _restoreStartupOverview() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._hadOverview !== undefined) {
            Main.sessionMode.hasOverview = this._hadOverview;
            this._hadOverview = undefined;
        }
        if (Main.overview.visible && !Main.overview.animationInProgress)
            Main.overview.hide();
    }

    /** The Overview's stock dash is replaced by the dock. */
    _hideOverviewDash() {
        const dash = Main.overview.dash;
        if (!dash || this._dashWasVisible !== undefined)
            return;
        this._dashWasVisible = dash.visible;
        this._dashId = dash.connect('notify::visible', () => {
            if (dash.visible)
                dash.hide();
        });
        dash.hide();
    }

    _showOverviewDash() {
        const dash = Main.overview.dash;
        if (this._dashId) {
            dash?.disconnect(this._dashId);
            this._dashId = 0;
        }
        if (this._dashWasVisible !== undefined) {
            if (dash && this._dashWasVisible)
                dash.show();
            this._dashWasVisible = undefined;
        }
    }

    _on(object, signal, callback) {
        this._connections.push([object, object.connect(signal, callback)]);
    }

    /** Build or remove the dock to match the `show-dock` setting. */
    _apply() {
        const wanted = this._dockWanted() || this._menuWanted();
        if (wanted && !this._built) {
            try {
                this._build();
            } catch (e) {
                console.error(`material3: dock failed to build: ${e.message}\n${e.stack}`);
            }
        }
        else if (!wanted && this._built)
            this._teardown();
    }

    _dockWanted() {
        return this._extSettings.get_boolean('show-dock');
    }

    _menuWanted() {
        return !this._extSettings.settings_schema.has_key('show-appmenu') ||
            this._extSettings.get_boolean('show-appmenu');
    }

    /** Dock bar (and its strut/edge) follow `show-dock`; the app menu can live without them. */
    _syncDockVisibility() {
        if (!this._built || !this._dock)
            return;
        this._reposition();
        const on = this._dockWanted();
        // The dock shares the menu's layer: in a fullscreen app it stays away
        // until the app menu opens, then both show.
        this._dock.actor.visible = on && !Main.overview.visible && (!this._fullscreen() || !!this._menuOpen);
        for (const actor of [this._strut, this._edge]) {
            if (actor)
                actor.visible = on;
        }
    }

    /** True while a fullscreen window covers the dock's monitor. */
    _fullscreen() {
        try {
            return !!global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
        } catch {
            return false;
        }
    }

    _build() {
        loadUi(this._extSettings);

        const host = {
            cycleTheme: () => cycleThemeKey(this._iface, this._extSettings),
            themeName: () => this._themeName(),
            endButton: () => this._extSettings.settings_schema.has_key('dock-end-button')
                ? this._extSettings.get_string('dock-end-button') : 'theme',
            openSettings: () => {
                try {
                    GLib.spawn_command_line_async('gnome-extensions prefs material3@local');
                } catch (e) {
                    console.error(`material3: cannot open the settings: ${e.message}`);
                }
            },
            sortMode: () => this._extSettings.settings_schema.has_key('appmenu-sort')
                ? this._extSettings.get_string('appmenu-sort') : 'name',
            setSortMode: mode => {
                if (this._extSettings.settings_schema.has_key('appmenu-sort'))
                    this._extSettings.set_string('appmenu-sort', mode);
            },
            toggleMenu: () => this._toggleMenu(),
            toggleDark: () => this._iface.set_string('color-scheme',
                this._isDark() ? 'default' : 'prefer-dark'),
            openChanged: open => {
                this._menuOpen = open;
                this._syncDockVisibility();
                this._dock?.setMenuActive(open);
                this._updateAutohide();
            },
            listHeight: () => this._extSettings.get_int('appmenu-height'),
            menuWidth: () => this._extSettings.get_int('appmenu-width'),
            power: this._power,
            userName: () => this._userName(),
            showRecent: () => this._extSettings.get_boolean('show-recent'),
            categoryConfig: () => readCategoryConfig(this._extSettings, _),
            itemContext: item => this._itemContext(item),
            itemHover: (item, hovered) => this._preview?.hover(item, hovered),
            itemActivated: () => this._preview?.hide(false),
        };

        try {
            this._power = new PowerBackend();
        } catch (e) {
            console.error(`material3: power profiles unavailable: ${e.message}`);
            this._power = null;
        }
        host.power = this._power;

        this._dock = new Dock(host);
        this._menu = new AppMenu(host);
        this._dockCtx = new ContextMenu({onOpenChanged: () => this._updateAutohide()});
        this._preview = new WindowPreview({
            blocked: () => !!(this._menu?.isOpen || this._dockCtx?.isOpen || Main.overview.visible),
            openChanged: () => this._updateAutohide(),
            previewScale: () => this._extSettings.settings_schema.has_key('preview-scale')
                ? this._extSettings.get_double('preview-scale') : 1,
        });

        // GNOME 51 no longer accepts `affectsInputRegion`; chrome always
        // takes part in the input region, so only the fullscreen option is
        // passed (and dropped too if a future shell rejects it).
        // Not tracked for fullscreen either (see _syncDockVisibility): the
        // dock sits in the same layer as the app menu so both can show over
        // a fullscreen app.
        Main.layoutManager.addChrome(this._dock.actor);
        // Not tracked for fullscreen: the layout manager would re-show the
        // (hidden) popover whenever a fullscreen window goes away.
        Main.layoutManager.addChrome(this._menu.actor);
        Main.layoutManager.addChrome(this._dockCtx.actor);
        Main.layoutManager.addChrome(this._preview.actor);

        // Mark built before anything else can fail, so a problem in one of
        // the hooks below never leaves the dock unpositioned and unthemed.
        this._built = true;
        this._shell = [];

        this._shownOnce = false;
        this._setupMode();

        // The Super (Windows) key opens the app menu instead of the Overview.
        Main.overview.toggle = () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else if (this._menuWanted())
                this._toggleMenu();
            else
                Object.getPrototypeOf(Main.overview).toggle.call(Main.overview);
        };
        this._syncMode();
        this._reposition();
        this._hideOverviewDash();

        const watch = (object, signal, callback) => {
            try {
                this._shell.push([object, object.connect(signal, callback)]);
            } catch (e) {
                console.error(`material3: dock could not watch ${signal}: ${e.message}`);
            }
        };

        const tracker = Shell.WindowTracker.get_default();
        const appSystem = Shell.AppSystem.get_default();

        watch(AppFavorites.getAppFavorites(), 'changed', () => this._dock.sync());
        this._settingsUnsub = onSettingsState(() => this._dock?.sync());
        watch(appSystem, 'app-state-changed', () => this._dock.sync());
        watch(tracker, 'notify::focus-app', () => this._queueIndicators());
        watch(global.window_manager, 'minimize', (_wm, actor) => {
            this._queueIndicators();
            this._bounceLater(tracker.get_window_app(actor.meta_window));
        });
        watch(global.window_manager, 'unminimize', () => this._queueIndicators());
        watch(Main.layoutManager, 'monitors-changed', () => this._reposition());
        watch(global.display, 'in-fullscreen-changed', () => this._syncDockVisibility());
        watch(Main.layoutManager, 'startup-complete', () => this._reposition());
        watch(Main.overview, 'showing', () => {
            this._menu.close();
            this._dock.actor.hide();
        });
        watch(Main.overview, 'hidden', () => {
            this._syncDockVisibility();
        });

        // Size changes (apps come and go, scale changes) move the center.
        watch(this._dock.actor, 'notify::allocation', () => this._reposition());

        if (Main.overview.visible)
            this._dock.actor.hide();
        this._syncDockVisibility();
    }

    _teardown() {
        if (!this._built)
            return;
        this._built = false;

        for (const [object, id] of this._shell ?? [])
            object.disconnect(id);
        this._shell = [];
        this._settingsUnsub?.();
        this._settingsUnsub = null;

        if (this._indicatorsId)
            GLib.source_remove(this._indicatorsId);
        this._indicatorsId = 0;

        this._showOverviewDash();
        delete Main.overview.toggle;
        this._teardownMode();

        if (this._preview) {
            Main.layoutManager.removeChrome(this._preview.actor);
            this._preview.destroy();
        }
        this._preview = null;

        if (this._dockCtx) {
            Main.layoutManager.removeChrome(this._dockCtx.actor);
            this._dockCtx.destroy();
        }
        this._dockCtx = null;

        if (this._menu) {
            Main.layoutManager.removeChrome(this._menu.actor);
            this._menu.destroy();
        }
        this._menu = null;
        this._power?.destroy();
        this._power = null;
        if (this._dock) {
            Main.layoutManager.removeChrome(this._dock.actor);
            this._dock.destroy();
        }
        this._dock = null;
    }

    /** Same name as the Quick Settings header: account, login, host or custom. */
    _userName() {
        const source = this._extSettings.get_string('name-source');
        let name;
        if (source === 'custom')
            name = this._extSettings.get_string('custom-name');
        else if (source === 'username')
            name = GLib.get_user_name();
        else if (source === 'hostname')
            name = GLib.get_host_name();
        else
            name = GLib.get_real_name();

        name = name?.trim();
        if (!name || (source === 'real-name' && name === 'Unknown'))
            name = GLib.get_user_name();
        return name;
    }

    _isDark() {
        return this._iface.get_string('color-scheme') === 'prefer-dark';
    }

    _themeName() {
        return _(THEME_NAMES[themeKeyFor(this._iface, this._extSettings)]);
    }

    _syncThemeName() {
        this._dock?.setThemeName(this._themeName());
    }

    /** Light/dark class on both surfaces (the palette rules key off it). */
    _syncMode() {
        if (!this._built)
            return;
        const dark = this._isDark();
        for (const actor of [this._dock.actor, this._menu.actor, this._dockCtx.actor, this._preview.actor]) {
            actor.remove_style_class_name('m3-light');
            actor.remove_style_class_name('m3-dark');
            actor.add_style_class_name(dark ? 'm3-dark' : 'm3-light');
        }
    }

    _autohide() {
        return this._extSettings.get_string('dock-mode') === 'autohide';
    }

    /** Static: reserve the dock's strip so windows stop above it. Auto-hide: a hot edge to reveal it. */
    _setupMode() {
        if (this._autohide()) {
            this._edge = new St.Widget({reactive: true, track_hover: true});
            Main.layoutManager.addChrome(this._edge, {trackFullscreen: true});
            this._edgeId = this._edge.connect('notify::hover', () => this._updateAutohide());
            this._hoverId = this._dock.connectHover(() => this._updateAutohide());
            this._hidden = false;
        } else {
            // An invisible full-width strip along the bottom: only chrome that
            // spans the monitor's edge becomes a strut.
            this._strut = new St.Widget({reactive: false});
            try {
                Main.layoutManager.addChrome(this._strut, {
                    affectsStruts: true,
                    trackFullscreen: true,
                    affectsInputRegion: false,
                });
            } catch {
                // GNOME 51 dropped the option; there chrome is only as
                // reactive as its actors, and this one is not. The failed
                // call already parented the actor.
                this._strut.get_parent()?.remove_child(this._strut);
                Main.layoutManager.addChrome(this._strut, {
                    affectsStruts: true,
                    trackFullscreen: true,
                });
            }
        }
    }

    _teardownMode() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._timeouts.delete(this._hideId);
            this._hideId = 0;
        }
        if (this._hoverId) {
            this._dock?.actor.get_child()?.disconnect(this._hoverId);
            this._hoverId = 0;
        }
        for (const actor of [this._strut, this._edge]) {
            if (!actor)
                continue;
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._strut = null;
        this._edge = null;
        this._hidden = false;
        this._shownOnce = false;
    }

    _margin() {
        return px(this._extSettings.get_int('dock-margin'));
    }

    /** Show the dock while the pointer, the app menu or a context menu needs it; slide it away otherwise. */
    _updateAutohide() {
        if (!this._built || !this._autohide())
            return;

        const wanted = this._dock.hovered || this._edge?.hover ||
            this._menu?.isOpen || this._dockCtx?.isOpen || this._preview?.isOpen;

        if (wanted) {
            if (this._hideId) {
                GLib.source_remove(this._hideId);
                this._timeouts.delete(this._hideId);
                this._hideId = 0;
            }
            this._slide(false);
        } else if (!this._hideId) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY, () => {
                this._timeouts.delete(id);
                this._hideId = 0;
                this._slide(true);
                return GLib.SOURCE_REMOVE;
            });
            this._hideId = id;
            this._timeouts.add(id);
        }
    }

    _slide(hidden, animate = true) {
        if (this._hidden === hidden && animate)
            return;
        this._hidden = hidden;

        const actor = this._dock.actor;
        const target = hidden ? actor.height + this._margin() + px(30) : 0;
        actor.remove_all_transitions();
        if (!animate) {
            actor.translation_y = target;
            return;
        }
        actor.ease({
            translation_y: target,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Bottom center of the primary monitor, `dock-margin` off the edge. */
    _reposition() {
        if (!this._built)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const actor = this._dock.actor;
        const [, width] = actor.get_preferred_width(-1);
        const [, height] = actor.get_preferred_height(width);
        const margin = this._margin();
        const x = monitor.x + Math.round((monitor.width - width) / 2);
        const y = monitor.y + monitor.height - height - margin;

        if (this._strut) {
            const strip = height + margin;
            this._strut.set_position(monitor.x, monitor.y + monitor.height - strip);
            this._strut.set_size(monitor.width, strip);
        }
        if (this._edge) {
            const edge = Math.max(2, px(2));
            const span = width + px(120);
            this._edge.set_position(monitor.x + Math.round((monitor.width - span) / 2),
                monitor.y + monitor.height - edge);
            this._edge.set_size(span, edge);
            // First layout: start slid away.
            if (this._hidden === false && !this._shownOnce) {
                this._shownOnce = true;
                this._later(() => this._dock && this._slide(true, false));
            }
        }

        // Called from the allocation signal too: only act on a real move.
        if (actor.x === x && actor.y === y)
            return;
        actor.set_position(x, y);

        // Positions are final only after the next layout pass.
        this._later(() => this._dock?.updateGeometry());
    }

    /** Right-click menu of a dock icon, above it. */
    _itemContext(item) {
        const actor = item.actor;
        const [x, y] = actor.get_transformed_position();
        const [width] = actor.get_transformed_size();
        const at = {x: x + width / 2, y: y - px(8), placement: 'above'};
        this._dockCtx.open(appContextItems(item.app, () => this._dockCtx.close(false), {
            reopen: items => this._dockCtx.open(items, at),
        }), at);
    }

    /** Rectangle of the Settings icon in the dock (for the window animation). */
    settingsAnchor() {
        const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop');
        return app ? this._dock?.itemRect(app) ?? null : null;
    }

    bounceSettings() {
        const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop');
        this._dock?.itemFor(app)?.bounce();
    }

    _toggleMenu() {
        if (!this._menuWanted()) {
            Object.getPrototypeOf(Main.overview).toggle.call(Main.overview);
            return;
        }
        try {
            if (this._menu.isOpen) {
                this._menu.close();
                return;
            }
            // Super just closed the menu: ignore its overlay-key echo.
            if (this._menu.justClosedBySuper())
                return;
            // Layout position, not the transformed one: an auto-hidden dock is
            // slid off screen but the menu belongs above where it comes back.
            // The dock is centered on the primary monitor, so the menu is
            // too: its position never depends on how many apps the dock holds.
            const actor = this._dock.actor;
            const monitor = Main.layoutManager.primaryMonitor;
            this._menu.open({
                centerX: monitor.x + monitor.width / 2,
                bottomY: actor.y - px(MENU_GAP),
            });
        } catch (e) {
            console.error(`material3: app menu toggle failed: ${e.message}\n${e.stack}`);
        }
    }

    _queueIndicators() {
        if (this._indicatorsId)
            return;
        this._indicatorsId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._indicatorsId = 0;
            this._dock?.updateIndicators();
            this._dock?.updateGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** One-shot timeout that is cancelled when the feature is disabled. */
    _later(callback, delay = 0) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    /** The window flies into the icon; bounce it when it lands. */
    _bounceLater(app) {
        this._later(() => this._dock?.itemFor(app)?.bounce(), 230);
    }

    /** Debounced: the settings window emits many changes while a value is dragged. */
    _scheduleRebuild() {
        if (this._rebuildId)
            GLib.source_remove(this._rebuildId);
        this._timeouts.delete(this._rebuildId);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._timeouts.delete(id);
            this._rebuildId = 0;
            if (this._built) {
                this._teardown();
                this._apply();
            }
            return GLib.SOURCE_REMOVE;
        });
        this._rebuildId = id;
        this._timeouts.add(id);
    }
}
