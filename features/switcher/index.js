import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from '../../i18n.js';
import {px} from '../quickSettings/ui.js';
import {centerBin, pressFeedback, symbolIcon, textLabel} from '../quickSettings/widgets.js';

const BINDINGS = [
    'switch-windows', 'switch-windows-backward',
    'switch-applications', 'switch-applications-backward',
    'switch-group', 'switch-group-backward',
];
const SHOW_DELAY = 150; // ms; a quick Alt+Tab tap switches without showing the HUD
let sizeFactor = 1; // switcher-scale
const THUMB_H = 128; // preview height at full size
const MIN_THUMB_H = 84;
const MIN_THUMB_W = 120; // keeps the icon, title and close button on one line
const MIN_ASPECT = 0.75;
const MAX_ASPECT = 2.2;
const GAP = 14;
const STRIP_PAD = 8; // room for the selected card's zoom and outline
// Card padding (8 + 8) and border (2 + 2) around the thumbnail, from the stylesheet.
const CARD_CHROME = 20;

/** The shell's own rule: the highest modifier bit of the binding is the one to release. */
function primaryModifier(mask) {
    if (!mask)
        return Clutter.ModifierType.MOD1_MASK;
    let primary = 1;
    while (mask > 1) {
        mask >>= 1;
        primary <<= 1;
    }
    return primary;
}

/**
 * The floating Alt+Tab HUD of the Android 17 reference: a rounded translucent
 * panel with one card per window (app icon, title, close button, thumbnail).
 * The selected card gets a secondary-container fill, a primary outline and a
 * slight zoom. There is no close button on the HUD itself.
 */
class WindowSwitcher {
    /**
     * @param {Meta.Window[]} windows most recently used first
     * @param {number} index first selection
     * @param {number} modifier the held modifier bit; releasing it commits
     * @param {boolean} dark
     * @param {function(): void} onDone
     */
    constructor(windows, index, modifier, dark, onDone) {
        this._windows = windows;
        this._selected = index;
        this._modifier = modifier;
        this._onDone = onDone;
        this._grab = null;
        this._showId = 0;
        this._shown = false;
        this._cards = [];
        // Cards ignore the pointer until it really moves: a pointer resting
        // where the HUD appears would otherwise flip hover styles on and off
        // under the cards while they scale in.
        this._pointerLive = false;
        this._pointerOrigin = null;
        this._sizes = [];
        this._total = 0;

        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        this.actor = new St.Widget({
            style_class: `m3-qs ${dark ? 'm3-dark' : 'm3-light'}`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        this._scrim = new St.Widget({style_class: 'm3-sw-scrim', x_expand: true, y_expand: true, opacity: 0});
        this.actor.add_child(this._scrim);

        this._hud = new St.BoxLayout({
            style_class: 'm3-sw-hud',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(10)}px; max-width: ${monitor.width - px(48)}px;`,
            opacity: 0,
        });
        this._hud.set_pivot_point(0.5, 0.5);
        this._title = textLabel('', 'm3-sw-title');

        this._strip = new St.BoxLayout({style: `spacing: ${px(GAP)}px; padding: ${px(STRIP_PAD + 6)}px ${px(STRIP_PAD + 4)}px;`});
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            clip_to_allocation: true,
        });
        this._scroll.add_child(this._strip);
        this._hud.add_child(this._scroll);
        this.actor.add_child(this._hud);

        this._rebuild();
        this._connectInput();
    }

    /**
     * GNOME Shell 51 reads keys through a Clutter.KeyController (as its own
     * switcher does) and a click outside the strip through a long-press
     * gesture; the old key/button event signals are not relied on.
     */
    _connectInput() {
        const keys = new Clutter.KeyController();
        keys.connect('key-press', controller => this._onKeyPress(controller));
        keys.connect('modifier-change', controller => this._onModifierChange(controller));
        this.actor.add_action(keys);

        // The wheel steps through the windows.
        this.actor.connect('scroll-event', (_actor, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT)
                this._step(-1);
            else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT)
                this._step(1);
            return Clutter.EVENT_STOP;
        });

        this.actor.connect('motion-event', (_actor, event) => {
            if (this._pointerLive)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this._pointerOrigin ??= [x, y];
            if (Math.hypot(x - this._pointerOrigin[0], y - this._pointerOrigin[1]) > px(6)) {
                this._pointerLive = true;
                for (const card of this._cards) {
                    card.actor.reactive = true;
                    card.close.reactive = true;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        try {
            const outside = new Clutter.LongPressGesture({long_press_duration_ms: 0});
            outside.connect('may-recognize', () => {
                const {x, y} = outside.get_coords_abs();
                const under = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
                return !under || !this._hud.contains(under);
            });
            outside.connect('recognize', () => this._finish(false));
            this.actor.add_action(outside);
        } catch (e) {
            console.error(`material3: switcher click-away unavailable: ${e.message}`);
        }
    }

    /** @returns {boolean} false when the keyboard could not be grabbed */
    start() {
        Main.uiGroup.add_child(this.actor);
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.SWITCHER});
        if (!this._grab) {
            this.actor.destroy();
            return false;
        }

        // The modifier may already be up: commit at once.
        const [, , mods] = global.get_pointer();
        if (!(mods & this._modifier)) {
            this._finish(true);
            return true;
        }

        this._showId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY, () => {
            this._showId = 0;
            this._showHud();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    /** Show the HUD before the start delay is over. */
    _showNow() {
        if (this._shown)
            return;
        if (this._showId)
            GLib.source_remove(this._showId);
        this._showId = 0;
        this._showHud();
    }

    _showHud() {
        this._shown = true;
        // The scroll view clipped the bottom of the cards: give it the strip's
        // full height (measured once the styles apply) plus a little air.
        try {
            const [, natural] = this._strip.get_preferred_height(-1);
            if (natural > 0 && this._scroll.visible)
                this._scroll.set_height(natural + px(24));
        } catch (e) {
            console.error(`material3: switcher height: ${e.message}`);
        }
        this._scrim.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        // Reference: scale .94 + rise 8px with a springy ease.
        this._hud.set_scale(0.94, 0.94);
        this._hud.translation_y = px(8);
        // The springy ease must not drive the opacity: it overshoots past the
        // maximum (the value wraps around and the panel flashes). Opacity gets
        // its own plain ease.
        this._hud.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._hud.ease({
            scale_x: 1, scale_y: 1, translation_y: 0,
            duration: 300, mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._reveal(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Size of every card. Cards share one thumbnail height and take their
     * width from the window's own aspect (clamped), so a preview never needs
     * letterboxing or cropping. The height shrinks until all windows fit on
     * screen (down to a minimum); beyond that the strip scrolls.
     */
    _layoutCards() {
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        const available = monitor.width - px(48) - px(36) - px(STRIP_PAD + 4) * 2;
        // The aspect comes from the window actor itself (what the clone draws),
        // the same size the dock's hover preview works from.
        const aspects = this._windows.map(w => {
            const [aw, ah] = w.get_compositor_private()?.get_size() ?? [16, 10];
            return Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, aw / Math.max(1, ah)));
        });
        const sizes = height => aspects.map(a => {
            const thumbW = Math.round(height * a);
            return {thumbW, thumbH: height, cardW: Math.max(thumbW, Math.round(px(MIN_THUMB_W) * Math.min(1, sizeFactor))) + px(CARD_CHROME)};
        });
        let height = Math.round(px(THUMB_H) * sizeFactor);
        let layout = sizes(height);
        const total = l => l.reduce((sum, c) => sum + c.cardW, 0) + px(GAP) * Math.max(0, l.length - 1);
        while (total(layout) > available && height > Math.round(px(MIN_THUMB_H) * Math.min(1, sizeFactor))) {
            height -= px(4);
            layout = sizes(height);
        }
        this._sizes = layout;
        this._total = total(layout);
    }

    _rebuild() {
        this._layoutCards();
        this._strip.destroy_all_children();
        this._cards = this._windows.map((window, i) => this._card(window, i));
        this._cards.forEach(c => this._strip.add_child(c.actor));
        this._title.set_text(this._windows.length === 1
            ? _('1 window open')
            : _('%d windows open').format(this._windows.length));
        // Explicit width: the strip's natural width would otherwise stretch the
        // HUD past the screen edge. Narrower than the strip, it scrolls.
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        const maxW = monitor.width - px(48) - px(36);
        const wanted = this._total + px(STRIP_PAD + 4) * 2;
        // When everything fits, the strip sits in the panel directly: nothing
        // clips it, so no card edge or preview is ever cut. Only an overflowing
        // list goes into the scroll view.
        const fits = wanted <= maxW;
        this._strip.get_parent()?.remove_child(this._strip);
        if (fits) {
            this._hud.add_child(this._strip);
            this._scroll.hide();
        } else {
            this._scroll.add_child(this._strip);
            this._scroll.set_width(maxW);
            this._scroll.show();
        }
        this._paintSelection(false);
    }

    _card(window, i) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const actor = new St.Button({
            style_class: 'm3-sw-card',
            can_focus: false,
            reactive: this._pointerLive,
            track_hover: true,
            width: this._sizes[i].cardW,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });
        actor.set_pivot_point(0.5, 0.5);
        // A button centers its child at natural width; the content must fill the card.
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.FILL,
            style: `spacing: ${px(8)}px;`,
        });

        const head = new St.BoxLayout({x_expand: true, style: `spacing: ${px(8)}px;`});
        const icon = app
            ? new St.Icon({gicon: app.get_icon(), icon_size: px(18)})
            : new St.Icon({icon_name: 'application-x-executable', icon_size: px(18)});
        // The app icon sits on a small rounded tile, like the reference's app badge.
        const badge = new St.Bin({
            style_class: 'm3-sw-badge', width: px(28), height: px(28), y_align: Clutter.ActorAlign.CENTER,
            child: icon,
        });
        head.add_child(badge);
        const title = textLabel(window.get_title() || app?.get_name() || '', 'm3-sw-card-title', {x_expand: true});
        title.clutter_text.set_single_line_mode(true);
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        head.add_child(title);
        const close = new St.Button({
            style_class: 'm3-sw-close',
            accessible_name: _('Close'),
            width: px(22),
            height: px(22),
            reactive: this._pointerLive,
            y_align: Clutter.ActorAlign.CENTER,
            child: centerBin(symbolIcon('close', {size: 14}), 'm3-prev-close-inner'),
        });
        pressFeedback(close);
        close.connect('clicked', () => {
            this._closeWindow(window);
            return Clutter.EVENT_STOP;
        });
        head.add_child(close);
        box.add_child(head);

        const {thumbW, thumbH} = this._sizes[i];
        // The card is wider than a narrow preview needs: the preview is centered.
        const slotW = this._sizes[i].cardW - px(CARD_CHROME);
        const thumb = new St.Widget({
            style_class: 'm3-sw-thumb',
            layout_manager: new Clutter.FixedLayout(),
            width: slotW,
            height: thumbH,
            clip_to_allocation: true,
        });
        this._addPreview(thumb, window, slotW, thumbW, thumbH);
        box.add_child(thumb);
        actor.set_child(box);

        actor.connect('clicked', (_b, which) => {
            if (which === 2) {
                this._closeWindow(window);
                return;
            }
            this._selected = this._windows.indexOf(window);
            this._finish(true);
        });
        return {actor, window, close};
    }

    /**
     * Live copy of the window, fitted whole inside the thumbnail. The window
     * actor also holds the invisible margins of client-side decorations (shadow);
     * the copy is placed by the window's visible frame, so those margins fall
     * outside the clip instead of pushing part of the window out of it.
     */
    _addPreview(thumb, window, slotW, thumbW, thumbH) {
        const source = window.get_compositor_private();
        if (!source)
            return;
        // The whole window actor is drawn, scaled to fit and centered. Its
        // transparent shadow margins are not trimmed: guessing them from the
        // frame rectangle cut real content off some windows.
        const [aw, ah] = source.get_size();
        if (aw <= 0 || ah <= 0)
            return;
        const scale = Math.min(thumbW / aw, thumbH / ah);
        const w = Math.max(1, Math.round(aw * scale));
        const h = Math.max(1, Math.round(ah * scale));
        const clone = new Clutter.Clone({source});
        clone.set_size(w, h);
        clone.set_position(Math.round((slotW - w) / 2), Math.round((thumbH - h) / 2));
        thumb.add_child(clone);
    }

    _paintSelection(animate = true) {
        this._cards.forEach(({actor}, i) => {
            const on = i === this._selected;
            if (on)
                actor.add_style_class_name('m3-sw-selected');
            else
                actor.remove_style_class_name('m3-sw-selected');
            const scale = on ? 1.03 : 1;
            if (animate && this._shown) {
                actor.ease({
                    scale_x: scale, scale_y: scale, duration: 240,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK,
                });
            } else {
                actor.set_scale(scale, scale);
            }
        });
    }

    /** Scroll the strip so the selected card is centered. */
    _reveal(animate = true) {
        const card = this._cards[this._selected]?.actor;
        const bar = this._scroll.hscroll ?? this._scroll.get_hscroll_bar?.();
        const adjustment = bar?.adjustment ?? bar?.get_adjustment?.();
        if (!card || !adjustment)
            return;
        const box = card.get_allocation_box();
        const target = Math.max(0, Math.min(
            box.x1 + (box.x2 - box.x1) / 2 - adjustment.page_size / 2,
            adjustment.upper - adjustment.page_size));
        if (animate) {
            adjustment.ease(target, {duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            adjustment.set_value(target);
        }
    }

    _step(delta) {
        const n = this._windows.length;
        if (n === 0)
            return;
        this._selected = (this._selected + delta + n) % n;
        // A second Tab inside the start delay means the user wants to see the list.
        if (!this._shown)
            this._showNow();
        this._paintSelection();
        this._reveal();
    }

    _closeWindow(window) {
        const index = this._windows.indexOf(window);
        if (index < 0)
            return;
        window.delete(global.get_current_time());
        // The window takes a moment to go away; drop its card now.
        this._windows.splice(index, 1);
        if (this._windows.length === 0) {
            this._finish(false);
            return;
        }
        if (this._selected >= this._windows.length)
            this._selected = this._windows.length - 1;
        else if (index < this._selected)
            this._selected -= 1;
        this._rebuild();
        this._reveal(false);
    }

    _onKeyPress(controller) {
        const [, key, keycode] = controller.get_key();
        const [, pressed, latched, locked] = controller.get_state();
        const mods = pressed | latched | locked;
        const shift = (mods & Clutter.ModifierType.SHIFT_MASK) !== 0;

        // The shell's own way to tell Alt+Tab from Alt+Shift+Tab.
        const action = global.display.get_keybinding_action(keycode, mods);
        const A = Meta.KeyBindingAction;
        if ([A.SWITCH_WINDOWS, A.SWITCH_APPLICATIONS, A.SWITCH_GROUP].includes(action)) {
            this._step(1);
            return Clutter.EVENT_STOP;
        }
        if ([A.SWITCH_WINDOWS_BACKWARD, A.SWITCH_APPLICATIONS_BACKWARD,
            A.SWITCH_GROUP_BACKWARD].includes(action)) {
            this._step(-1);
            return Clutter.EVENT_STOP;
        }

        switch (key) {
        case Clutter.KEY_Tab:
        case Clutter.KEY_grave:
        case Clutter.KEY_asciitilde:
            this._step(shift ? -1 : 1);
            break;
        case Clutter.KEY_ISO_Left_Tab:
            this._step(-1);
            break;
        case Clutter.KEY_Right:
            this._step(1);
            break;
        case Clutter.KEY_Left:
            this._step(-1);
            break;
        case Clutter.KEY_Escape:
            this._finish(false);
            break;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
        case Clutter.KEY_space:
            this._finish(true);
            break;
        case Clutter.KEY_Delete:
        case Clutter.KEY_w:
        case Clutter.KEY_W:
        case Clutter.KEY_F4:
            this._closeWindow(this._windows[this._selected]);
            break;
        default:
            break;
        }
        return Clutter.EVENT_STOP;
    }

    /** Releasing the held modifier (Alt/Super) commits the selection. */
    _onModifierChange(controller) {
        const [, pressed, latched, locked] = controller.get_state();
        if (!((pressed | latched | locked) & this._modifier))
            this._finish(true);
        return Clutter.EVENT_STOP;
    }

    /** @param {boolean} activate focus the selected window */
    _finish(activate) {
        if (!this.actor)
            return;
        const window = activate ? this._windows[this._selected] : null;
        this.destroy({fade: true});
        if (window)
            Main.activateWindow(window);
        this._onDone();
    }

    /** @param {{fade: boolean}} [options] fade the HUD out (input is released at once) */
    destroy({fade = false} = {}) {
        if (this._showId)
            GLib.source_remove(this._showId);
        this._showId = 0;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }

        const actor = this.actor;
        this.actor = null;
        if (!actor)
            return;
        if (fade && this._shown) {
            // Vanishing in one frame reads as a flash: let it fade.
            actor.reactive = false;
            actor.remove_all_transitions();
            actor.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => actor.destroy(),
            });
        } else {
            actor.destroy();
        }
    }
}

/** Replaces the shell's Alt+Tab window switcher. */
export class SwitcherFeature {
    constructor(settings) {
        this._settings = settings;
        this._iface = null;
        this._switcher = null;
    }

    enable() {
        this._applyScale();
        this._scaleId = this._settings.connect('changed::switcher-scale', () => this._applyScale());
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        for (const name of BINDINGS) {
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL,
                (display, window, ...rest) => this._run(display, window, rest));
        }
    }

    disable() {
        if (this._scaleId)
            this._settings.disconnect(this._scaleId);
        this._scaleId = 0;
        this._switcher?.destroy();
        this._switcher = null;
        for (const name of BINDINGS) {
            try {
                // The shell's own handler: its private method, present on every recent shell.
                Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL,
                    Main.wm._startSwitcher.bind(Main.wm));
            } catch (e) {
                console.error(`material3: cannot restore ${name}: ${e.message}`);
            }
        }
        this._iface?.run_dispose();
        this._iface = null;
    }

    /**
     * Our switcher; if it fails for any reason, the shell's own switcher takes over.
     * GNOME Shell 51 calls handlers as (display, window, event, binding); older
     * shells as (display, window, binding), so the binding is picked by what it can do.
     */
    _run(display, window, rest) {
        const binding = rest.find(a => typeof a?.get_name === 'function');
        try {
            if (!binding)
                throw new Error('no key binding was passed to the handler');
            this._start(display, binding);
        } catch (e) {
            console.error(`material3: switcher failed: ${e.message}\n${e.stack}`);
            this._switcher?.destroy();
            this._switcher = null;
            try {
                Main.wm._startSwitcher(display, window, ...rest);
            } catch (fallback) {
                console.error(`material3: the shell's switcher failed too: ${fallback.message}`);
            }
        }
    }

    _applyScale() {
        sizeFactor = this._settings.settings_schema.has_key('switcher-scale')
            ? this._settings.get_double('switcher-scale') : 1;
    }

    _start(display, binding) {
        if (this._switcher)
            return;
        const name = binding.get_name();
        const backward = binding.is_reversed?.() ?? name.endsWith('-backward');
        const workspace = global.workspace_manager.get_active_workspace();
        let windows = display.get_tab_list(Meta.TabList.NORMAL, workspace).filter(w => !w.skip_taskbar);
        if (name.startsWith('switch-group')) {
            const tracker = Shell.WindowTracker.get_default();
            const app = windows[0] ? tracker.get_window_app(windows[0]) : null;
            if (app)
                windows = windows.filter(w => tracker.get_window_app(w) === app);
        }
        if (windows.length === 0)
            return;

        // Most recent first: index 0 is the current window, so go to the next (or last).
        const index = windows.length > 1 ? (backward ? windows.length - 1 : 1) : 0;
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        const modifier = primaryModifier(binding.get_mask());
        const switcher = new WindowSwitcher(windows, index, modifier, dark, () => {
            this._switcher = null;
        });
        this._switcher = switcher;
        if (!switcher.start())
            this._switcher = null;
    }
}
