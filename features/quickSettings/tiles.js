import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Ease, mixColor, tweenerFor} from './animation.js';
import {tileText} from './palette.js';
import {px} from './ui.js';
import {symbolIcon, styleSymbol, truncatedLabel} from './widgets.js';

const TILE_WIDTH = 159;
const TILE_HEIGHT = 64;
const TILE_TEXT_WIDTH = 97;

const RADIUS_IDLE = 28;
const RADIUS_ACTIVE = 18;
// How long a click is trusted over backend state while the system catches up.
const PENDING_MS = 2500;

/**
 * Expressive quick toggle. Reference behaviour (`.qs-tile-btn`):
 *  - toggle: radius 28 <-> 18 (bounce .32s), fill/colors fade (~.28s),
 *    icon scale 1.12 when active (bounce .34s), pop 0.93 -> 1.03 -> 1
 *  - held: scale 0.94 (bounce .18s)
 */
class Tile {
    /**
     * @param {object} config
     * @param {string} config.icon
     * @param {string} config.title
     * @param {boolean} [config.filledIcon]
     * @param {object} config.backend object with `state` and `toggle()`
     * @param {function(): void} [config.onSecondary] right-click handler
     */
    constructor({icon, title, filledIcon = false, backend, onSecondary = null}) {
        this._backend = backend;
        this._onSecondary = onSecondary;
        this._theme = 'purple';
        this._dark = false;
        this._active = false;
        this._pending = null;
        this._pendingId = 0;
        this._radius = px(RADIUS_IDLE);
        this._tint = 0;
        this._iconScale = 1;
        this._pressScale = 1;
        this._popScale = 1;

        this.actor = new St.Button({
            style_class: 'm3-tile',
            width: px(TILE_WIDTH),
            height: px(TILE_HEIGHT),
            can_focus: true,
            reactive: true,
            button_mask: onSecondary
                ? St.ButtonMask.PRIMARY | St.ButtonMask.SECONDARY
                : St.ButtonMask.PRIMARY,
        });
        this._tweener = tweenerFor(this.actor);
        this.actor.set_pivot_point(0.5, 0.5);

        const stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._fill = new St.Widget({
            style_class: 'm3-tile-fill',
            x_expand: true,
            y_expand: true,
            opacity: 0,
        });
        stack.add_child(this._fill);

        const content = new St.BoxLayout({
            style_class: 'm3-tile-content',
            style: `spacing: ${px(12)}px;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = symbolIcon(icon, {
            size: 22,
            filled: filledIcon,
            styleClass: 'm3-tile-icon',
        });
        content.add_child(this._icon);

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: px(TILE_TEXT_WIDTH),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = truncatedLabel(title, 'm3-tile-title', TILE_TEXT_WIDTH);
        this._subtitle = truncatedLabel('', 'm3-tile-subtitle', TILE_TEXT_WIDTH);
        textBox.add_child(this._title);
        textBox.add_child(this._subtitle);
        content.add_child(textBox);
        stack.add_child(content);

        this.actor.set_child(stack);

        this.actor.connect('notify::pressed', () => this._onPressed());
        this.actor.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY)
                this._onSecondary?.();
            else
                this._onClicked();
        });

        this._unsubscribe = backend.subscribe(() => this._onBackend());
        this.actor.connect('destroy', () => {
            this._unsubscribe();
            this._clearPending();
        });

        this._apply(backend.state, false);
    }

    /**
     * @param {string} theme
     * @param {boolean} dark
     */
    setAppearance(theme, dark) {
        this._theme = theme;
        this._dark = dark;
        this._paintTint(this._tint);
    }

    sync() {
        this._clearPending();
        this._apply(this._backend.state, false);
    }

    _onClicked() {
        const state = this._backend.state;
        if (!state.available)
            return;

        // Optimistic: flip immediately like the reference, then let the
        // backend confirm. Backend values that still show the old state are
        // ignored for a short while.
        const target = !this._active;
        this._clearPending();
        this._pending = {target};
        this._pendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PENDING_MS, () => {
            this._pendingId = 0;
            this._pending = null;
            this._apply(this._backend.state, true);
            return GLib.SOURCE_REMOVE;
        });

        this._setActive(target, true);
        this._pop();
        this._backend.toggle();
    }

    _onBackend() {
        const state = this._backend.state;
        if (this._pending) {
            if (state.active !== this._pending.target) {
                // Still catching up; only refresh text.
                this._subtitle.set_text(state.subtitle ?? '');
                return;
            }
            this._clearPending();
        }
        this._apply(state, true);
    }

    _clearPending() {
        if (this._pendingId)
            GLib.source_remove(this._pendingId);
        this._pendingId = 0;
        this._pending = null;
    }

    _apply(state, animate) {
        this._subtitle.set_text(state.subtitle ?? '');
        if (state.icon)
            this._icon.set_text(state.icon);

        this.actor.reactive = state.available;
        this.actor.opacity = state.available ? 255 : 128;

        this._setActive(state.active, animate);
    }

    _setActive(active, animate) {
        const changed = active !== this._active;
        this._active = active;
        const target = active ? 1 : 0;
        const duration = animate && changed ? 1 : 0;

        this._tweener.run('radius', {
            from: this._radius,
            to: px(active ? RADIUS_ACTIVE : RADIUS_IDLE),
            duration: 320 * duration,
            ease: Ease.bounce,
            onUpdate: v => this._paintRadius(v),
        });

        this._tweener.run('tint', {
            from: this._tint,
            to: target,
            duration: 280 * duration,
            ease: Ease.spring,
            onUpdate: t => this._paintTint(t),
        });

        this._tweener.run('icon', {
            from: this._iconScale,
            to: active ? 1.12 : 1,
            duration: 340 * duration,
            ease: Ease.bounce,
            onUpdate: s => {
                this._iconScale = s;
                this._icon.set_scale(s, s);
            },
        });
    }

    _paintRadius(radius) {
        this._radius = radius;
        const style = `border-radius: ${Math.max(0, radius).toFixed(1)}px;`;
        this.actor.set_style(style);
        this._fill.set_style(style);
    }

    _paintTint(t) {
        this._tint = t;
        const c = tileText(this._theme, this._dark);

        this._fill.opacity = Math.round(Math.max(0, Math.min(1, t)) * 255);
        styleSymbol(this._icon, `color: ${mixColor(c.icon, c.onIcon, t)};`);
        this._title.set_style(`color: ${mixColor(c.title, c.onTitle, t)};`);
        this._subtitle.set_style(`color: ${mixColor(c.subtitle, c.onSubtitle, t)};`);
    }

    /** `.qs-tile-pop`: 0.93 -> 1.03 (55%) -> 1 over 340ms, bounce per leg. */
    _pop() {
        const apply = s => {
            this._popScale = s;
            this._applyScale();
        };
        this._tweener.run('pop', {
            from: 0.93,
            to: 1.03,
            duration: 340 * 0.55,
            ease: Ease.bounce,
            onUpdate: apply,
            onComplete: () => this._tweener.run('pop', {
                from: 1.03,
                to: 1,
                duration: 340 * 0.45,
                ease: Ease.bounce,
                onUpdate: apply,
            }),
        });
    }

    _onPressed() {
        this._tweener.run('press', {
            from: this._pressScale,
            to: this.actor.pressed ? 0.94 : 1,
            duration: 180,
            ease: Ease.bounce,
            onUpdate: s => {
                this._pressScale = s;
                this._applyScale();
            },
        });
    }

    _applyScale() {
        const s = this._pressScale * this._popScale;
        this.actor.set_scale(s, s);
    }
}

/**
 * 2-column grid of expressive quick toggles.
 *
 * @param {Array<object>} tiles
 * @returns {{actor: St.BoxLayout, tiles: Array<Tile>}}
 */
export function buildTileGrid(tiles) {
    const grid = new St.BoxLayout({
        style_class: 'm3-tile-grid',
        orientation: Clutter.Orientation.VERTICAL,
        style: `spacing: ${px(10)}px;`,
    });

    const instances = [];
    for (let i = 0; i < tiles.length; i += 2) {
        const row = new St.BoxLayout({style: `spacing: ${px(10)}px;`});
        for (const config of tiles.slice(i, i + 2)) {
            const tile = new Tile(config);
            instances.push(tile);
            row.add_child(tile.actor);
        }

        if (tiles.slice(i, i + 2).length === 1)
            row.add_child(new St.Widget({width: px(TILE_WIDTH)}));

        grid.add_child(row);
    }

    return {actor: grid, tiles: instances};
}

