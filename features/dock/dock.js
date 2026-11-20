import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from '../../i18n.js';

import {Ease, lerp, tweenerFor} from '../quickSettings/animation.js';
import {isSettingsApp, settingsApi} from '../settings/launcher.js';
import {px, scoped} from '../quickSettings/ui.js';
import {centerBin, pressFeedback, symbolIcon, textLabel} from '../quickSettings/widgets.js';

const ITEM_SIZE = 48;
const DOT_WIDTH = 16;

/** Reference `dockAbsorbBounce` keyframes: [from, to, scale0, scale1, y0, y1]. */
const ABSORB = [
    [0, 0.35, 1, 0.84, 0, 3],
    [0.35, 0.7, 0.84, 1.16, 3, -4],
    [0.7, 1, 1.16, 1, -4, 0],
];

/** One application button of the dock, with its running indicator. */
class DockItem {
    /**
     * @param {Shell.App} app
     * @param {Dock} dock
     */
    constructor(app, dock) {
        this.app = app;
        this._dock = dock;
        this._state = '';
        this._dotWidth = 0;
        this._dotOpacity = 0;

        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: px(ITEM_SIZE),
            height: px(ITEM_SIZE),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.set_pivot_point(0.5, 0.5);
        this._tweener = tweenerFor(this.actor);

        this.button = new St.Button({
            style_class: 'm3-dock-item',
            accessible_name: app.get_name(),
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: true,
            y_expand: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
        });
        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: px(30),
        });
        this.button.set_child(centerBin(icon, 'm3-dock-item-inner'));
        pressFeedback(this.button);
        this.button.connect('notify::hover', () => dock.itemHovered(this, this.button.hover));
        this.button.connect('clicked', (_button, which) => {
            if (which === 3)
                dock.contextRequested(this);
            else if (which === 2)
                this._launchNew();
            else
                dock.toggle(app);
        });
        this.actor.add_child(this.button);

        // Reference `-bottom-1 w-4 h-1` dot: sits just under the tile. It is
        // placed by hand in a fixed layout (it must lie outside the tile, and
        // alignment inside the tile's layout would put it over the icon).
        // The holder must fill the tile exactly: a BinLayout centers children
        // that do not fill, which shifted the dot sideways by half its width.
        this._dotHolder = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
            width: px(ITEM_SIZE),
            height: px(ITEM_SIZE),
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            clip_to_allocation: false,
        });
        // Full width always, positioned once; the width animation is a
        // horizontal scale around its center, so it stays centered under the tile.
        this.dot = new St.Widget({
            style_class: 'm3-dock-dot',
            width: px(DOT_WIDTH),
            height: px(4),
            opacity: 0,
            reactive: false,
        });
        this.dot.set_pivot_point(0.5, 0.5);
        this.dot.set_scale(0, 1);
        this.dot.set_position(Math.round((px(ITEM_SIZE) - px(DOT_WIDTH)) / 2), px(ITEM_SIZE));
        this._dotHolder.add_child(this.dot);
        this.actor.add_child(this._dotHolder);

        this._windowsId = app.connect('windows-changed', () => dock.windowsChanged());
    }

    _launchNew() {
        const settings = settingsApi();
        if (settings && isSettingsApp(this.app)) {
            settings.open(null);
            return;
        }
        try {
            this.app.open_new_window(-1);
        } catch (e) {
            console.error(`material3: failed to open a new window: ${e.message}`);
        }
    }

    /**
     * @param {string} state closed | minimized | open
     */
    setIndicator(state) {
        if (state === this._state)
            return;
        this._state = state;

        const toWidth = px(state === 'open' ? DOT_WIDTH : state === 'minimized' ? 6 : 0);
        const toOpacity = state === 'open' ? 1 : state === 'minimized' ? 0.7 : 0;
        const fromWidth = this._dotWidth;
        const fromOpacity = this._dotOpacity;

        this._tweener.run('dot', {
            from: 0,
            to: 1,
            duration: 200,
            ease: Ease.spring,
            onUpdate: t => {
                this._dotWidth = lerp(fromWidth, toWidth, t);
                this._dotOpacity = lerp(fromOpacity, toOpacity, t);
                this.dot.set_scale(this._dotWidth / px(DOT_WIDTH), 1);
                this.dot.opacity = Math.round(this._dotOpacity * 255);
            },
        });
    }

    /** Reference `.dock-absorb`: squash, overshoot, settle. */
    bounce() {
        this._tweener.run('bounce', {
            from: 0,
            to: 1,
            duration: 440,
            ease: Ease.linear,
            onUpdate: t => {
                const seg = ABSORB.find(s => t <= s[1]) ?? ABSORB[2];
                const k = Ease.bounce((t - seg[0]) / (seg[1] - seg[0]));
                const scale = lerp(seg[2], seg[3], k);
                this.actor.set_scale(scale, scale);
                this.actor.translation_y = px(lerp(seg[4], seg[5], k));
            },
            onComplete: () => {
                this.actor.set_scale(1, 1);
                this.actor.translation_y = 0;
            },
        });
    }

    destroy() {
        this.app.disconnect(this._windowsId);
        this.actor.destroy();
    }
}

/**
 * The floating pill dock of the reference: app-menu button, running and
 * favorite apps with indicator dots, and the palette cycler.
 */
export class Dock {
    /**
     * @param {object} host
     * @param {function(): void} host.toggleMenu
     * @param {function(): void} host.cycleTheme
     * @param {function(): string} host.themeName
     */
    constructor(host) {
        this._host = host;
        this._items = new Map();
        scoped('dock', () => this._build(host));
    }

    _build(host) {

        // The wrapper carries `m3-qs` (+ light/dark) so the same palette
        // rules as the Quick Settings panel apply to everything inside.
        this.actor = new St.Bin({style_class: 'm3-qs m3-dock'});

        this._bar = new St.BoxLayout({
            style_class: 'm3-dock-bar',
            style: `spacing: ${px(8)}px;`,
            reactive: true,
            track_hover: true,
        });
        this.actor.set_child(this._bar);

        this.appsButton = new St.Button({
            style_class: 'm3-dock-apps',
            accessible_name: _('App Menu'),
            width: px(44),
            height: px(44),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.appsButton.set_child(centerBin(symbolIcon('apps', {size: 22}), 'm3-dock-apps-inner'));
        pressFeedback(this.appsButton);
        this.appsButton.connect('clicked', () => host.toggleMenu());
        this._bar.add_child(this.appsButton);

        this._bar.add_child(this._divider());

        this._box = new St.BoxLayout({
            style: `spacing: ${px(8)}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._bar.add_child(this._box);

        this._bar.add_child(this._divider());

        const pill = new St.Button({
            style_class: 'm3-dock-theme',
            accessible_name: _('Switch Material You Palette'),
            height: px(44),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const pillContent = new St.BoxLayout({style: `spacing: ${px(8)}px;`});
        pillContent.add_child(symbolIcon('color_lens', {size: 19, filled: true}));
        this._themeLabel = textLabel(host.themeName(), 'm3-dock-theme-name');
        pillContent.add_child(this._themeLabel);
        pill.set_child(pillContent);
        pressFeedback(pill);
        pill.connect('clicked', () => host.cycleTheme());
        this._bar.add_child(pill);

        this.sync();
    }

    /** True while the pointer is over the dock bar. */
    get hovered() {
        return this._bar.hover;
    }

    connectHover(callback) {
        return this._bar.connect('notify::hover', callback);
    }

    contextRequested(item) {
        this._host.itemActivated?.();
        this._host.itemContext?.(item);
    }

    itemHovered(item, hovered) {
        this._host.itemHover?.(item, hovered);
    }

    _divider() {
        return new St.Widget({
            style_class: 'm3-dock-divider',
            width: px(1),
            height: px(28),
            y_align: Clutter.ActorAlign.CENTER,
            style: `margin: 0 ${px(2)}px;`,
        });
    }

    setThemeName(name) {
        this._themeLabel.set_text(name);
    }

    /** Highlight the menu button while the app menu is open. */
    setMenuActive(active) {
        if (active)
            this.appsButton.add_style_class_name('m3-active');
        else
            this.appsButton.remove_style_class_name('m3-active');
    }

    /** Favorites first, then the other running applications. */
    sync() {
        scoped('dock', () => this._sync());
    }

    _sync() {
        const favorites = AppFavorites.getAppFavorites().getFavorites();
        const favoriteIds = new Set(favorites.map(a => a.get_id()));
        const running = Shell.AppSystem.get_default().get_running()
            .filter(a => !favoriteIds.has(a.get_id()));
        const apps = [...favorites, ...running];

        // The Settings window is not a Meta window, so the shell does not
        // list it as running: show its icon while the window is open.
        const settings = settingsApi();
        if (settings && settings.state() !== 'closed') {
            const stock = Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop');
            if (stock && !apps.some(a => a.get_id() === stock.get_id()))
                apps.push(stock);
        }
        const ids = new Set(apps.map(a => a.get_id()));

        for (const [id, item] of [...this._items]) {
            if (ids.has(id))
                continue;
            item.destroy();
            this._items.delete(id);
        }

        apps.forEach((app, index) => {
            const id = app.get_id();
            let item = this._items.get(id);
            if (!item) {
                item = new DockItem(app, this);
                this._items.set(id, item);
                this._box.add_child(item.actor);
            }
            this._box.set_child_at_index(item.actor, index);
        });

        this.updateIndicators();
    }

    /** Reference `updateDockIndicators`: none / small / wide dot. */
    updateIndicators() {
        for (const item of this._items.values()) {
            const app = item.app;
            const windows = app.get_windows();
            let state = 'closed';

            if (windows.length > 0)
                state = windows.every(w => w.minimized) ? 'minimized' : 'open';
            else if (app.state === Shell.AppState.STARTING)
                state = 'open';

            const settings = settingsApi();
            if (settings && isSettingsApp(app))
                state = settings.state();

            item.setIndicator(state);
        }
    }

    /**
     * Tell the compositor where each app's button is, so the minimize
     * animation flies into the right icon (the HTML's `computeDockDelta`).
     */
    updateGeometry() {
        for (const item of this._items.values()) {
            const windows = item.app.get_windows();
            if (windows.length === 0 || !item.actor.mapped)
                continue;

            const rect = new Mtk.Rectangle();
            [rect.x, rect.y] = item.actor.get_transformed_position();
            [rect.width, rect.height] = item.actor.get_transformed_size();
            for (const window of windows)
                window.set_icon_geometry(rect);
        }
    }

    windowsChanged() {
        this.updateIndicators();
        this.updateGeometry();
    }

    /** Rectangle of an app's button in stage coordinates, or null. */
    itemRect(app) {
        const item = this.itemFor(app);
        if (!item || !item.actor.mapped)
            return null;
        const [x, y] = item.actor.get_transformed_position();
        const [width, height] = item.actor.get_transformed_size();
        return {x, y, width, height};
    }

    itemFor(app) {
        return app ? this._items.get(app.get_id()) ?? null : null;
    }

    /** Reference `toggleDockApp`: open if closed or minimized, else minimize. */
    toggle(app) {
        this._host.itemActivated?.();
        if (Main.overview.visible)
            Main.overview.hide();

        const settings = settingsApi();
        if (settings && isSettingsApp(app)) {
            settings.toggle();
            return;
        }

        const windows = app.get_windows();
        if (windows.length === 0) {
            app.activate();
            return;
        }

        const focused = Shell.WindowTracker.get_default().focus_app === app;
        if (focused && !windows.every(w => w.minimized))
            windows.forEach(w => w.minimize());
        else
            app.activate();
    }

    destroy() {
        for (const item of this._items.values())
            item.destroy();
        this._items.clear();
        this.actor.destroy();
    }
}
