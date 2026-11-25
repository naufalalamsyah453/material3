import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {_} from './i18n.js';
import {debounce, gs} from './sys.js';
import {palette, unit} from './theme.js';

// ---- small builders ---------------------------------------------------

const addClasses = (widget, classes) => {
    for (const name of classes.split(' ').filter(Boolean))
        widget.add_css_class(name);
    return widget;
};

export function box(vertical = false, spacing = 0, classes = '') {
    return addClasses(new Gtk.Box({
        orientation: vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
        spacing,
    }), classes);
}

export const vbox = (spacing = 0, classes = '') => box(true, spacing, classes);
export const hbox = (spacing = 0, classes = '') => box(false, spacing, classes);

/** Text label. `wrap` makes it follow the width it is given. */
export function label(text, classes = '', {wrap = false, xalign = 0, selectable = false,
    ellipsize = false, hexpand = false} = {}) {
    const widget = new Gtk.Label({
        label: `${text ?? ''}`,
        xalign,
        wrap,
        selectable,
        hexpand,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        ellipsize: ellipsize ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE,
    });
    return addClasses(widget, classes);
}

/** Material Symbols ligature. */
export function icon(name, {size = 20, fill = false} = {}) {
    const widget = new Gtk.Label({label: name});
    addClasses(widget, `ms ${fill ? 'fill ' : ''}${size === 20 ? '' : `ms-${size}`}`);
    return widget;
}

/** Icon centered in a round tonal tile. */
export function tile(name, size = 40) {
    const holder = new Gtk.CenterBox({valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER});
    addClasses(holder, 'm3-tile');
    holder.set_size_request(size, size);
    holder.set_center_widget(icon(name, {size: size > 36 ? 20 : 18, fill: true}));
    return holder;
}

export function badge(text, primary = false) {
    return label(text, `m3-badge${primary ? ' primary' : ''}`, {xalign: 0.5});
}

export function separator() {
    return addClasses(new Gtk.Separator(), 'm3-sep');
}

/** Page title and one-line description. */
export function heading(title, subtitle = '') {
    const holder = vbox(2);
    holder.append(label(title, 'm3-title', {wrap: true}));
    if (subtitle)
        holder.append(label(subtitle, 'm3-subtitle', {wrap: true}));
    return holder;
}

export const sectionLabel = text => label(text, 'm3-section');

export function card(...children) {
    const holder = vbox(14, 'm3-card');
    children.filter(Boolean).forEach(child => holder.append(child));
    return holder;
}

/** Card of rows separated by hairlines. */
export function listCard(rows) {
    // Android style: every row is a tile of its own, the group's outer corners are round.
    const holder = vbox(3, 'm3-card list');
    rows.filter(Boolean).forEach(item => holder.append(item));
    return holder;
}

/** Message card for empty lists and missing services. */
export function note(text, iconName = 'info') {
    const holder = hbox(12, 'm3-card');
    holder.append(icon(iconName, {size: 22}));
    holder.append(label(text, 'm3-row-sub', {wrap: true, hexpand: true}));
    return holder;
}

/**
 * One settings row.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.sub]
 * @param {string} [p.icon] Material symbol in a tonal tile
 * @param {Gtk.Widget} [p.trailing]
 * @param {function(): void} [p.onClick] makes the whole row clickable
 */
export function row({title, sub = '', icon: iconName = null, trailing = null, onClick = null}) {
    const holder = hbox(14, 'm3-row');
    if (iconName)
        holder.append(tile(iconName));

    const text = vbox(2);
    text.hexpand = true;
    text.valign = Gtk.Align.CENTER;
    const titleLabel = label(title, 'm3-row-title', {wrap: true});
    const subLabel = label(sub, 'm3-row-sub', {wrap: true});
    subLabel.visible = !!sub;
    text.append(titleLabel);
    text.append(subLabel);
    holder.append(text);

    if (trailing) {
        trailing.valign = Gtk.Align.CENTER;
        holder.append(trailing);
    }
    if (onClick) {
        holder.add_css_class('clickable');
        const click = new Gtk.GestureClick();
        click.connect('released', () => onClick());
        holder.add_controller(click);
    }

    holder.setTitle = value => titleLabel.set_label(value);
    holder.setSub = value => {
        subLabel.set_label(value);
        subLabel.visible = !!value;
    };
    return holder;
}

// ---- buttons ------------------------------------------------------------

/** Text button. `variant`: '' (default), 'filled', 'tonal', 'danger'. */
export function pillButton(text, onClick, {icon: iconName = null, variant = ''} = {}) {
    const button = addClasses(new Gtk.Button({valign: Gtk.Align.CENTER}), `m3-btn ${variant}`);
    const content = hbox(6);
    if (iconName)
        content.append(icon(iconName, {size: 16, fill: true}));
    const caption = new Gtk.Label({label: text});
    content.append(caption);
    button.set_child(content);
    button.connect('clicked', () => onClick(button));
    button.setLabel = value => caption.set_label(value);
    return button;
}

export function iconButton(name, onClick, tooltip = '') {
    const button = addClasses(new Gtk.Button({valign: Gtk.Align.CENTER}), 'm3-icon');
    button.set_child(icon(name, {size: 18}));
    if (tooltip)
        button.set_tooltip_text(tooltip);
    button.connect('clicked', () => onClick(button));
    return button;
}

/** Segmented chips, one active. */
export function chips(options, current, onSelect) {
    const holder = hbox(8);
    const buttons = new Map();
    const sync = value => {
        for (const [id, button] of buttons) {
            if (id === value)
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
    };
    for (const {id, label: text} of options) {
        const button = addClasses(new Gtk.Button({label: text}), 'm3-chip');
        button.connect('clicked', () => {
            sync(id);
            onSelect(id);
        });
        buttons.set(id, button);
        holder.append(button);
    }
    sync(current);
    return {widget: holder, set: sync};
}

// ---- toast and dialogs --------------------------------------------------

let toastRevealer = null;
let toastLabel = null;
let toastId = 0;
let mainWindow = null;

export function setMainWindow(window) {
    mainWindow = window;
}

export const getMainWindow = () => mainWindow;

let navigator = null;
/** Lets a page open another page of the app. */
export const setNavigator = fn => { navigator = fn; };
export const navigate = id => navigator?.(id);

/** The overlay that shows the toast pill. */
export function createToast() {
    toastLabel = label('', 'm3-toast');
    toastRevealer = new Gtk.Revealer({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.END,
        transition_type: Gtk.RevealerTransitionType.SLIDE_UP,
        transition_duration: 220,
        can_target: false,
        child: toastLabel,
    });
    return toastRevealer;
}

export function toast(message = _('Settings updated')) {
    if (!toastRevealer)
        return;
    toastLabel.set_label(message);
    toastRevealer.reveal_child = true;
    if (toastId)
        GLib.source_remove(toastId);
    toastId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1800, () => {
        toastId = 0;
        toastRevealer.reveal_child = false;
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Modal dialog with a body and buttons; resolves with the id of the pressed
 * button (null when closed).
 *
 * @param {object} p
 * @param {string} p.title
 * @param {Gtk.Widget} [p.content]
 * @param {string} [p.message]
 * @param {Array<{id: string, label: string, variant?: string}>} p.buttons
 * @param {function(Gtk.Window, function(string): void): void} [p.onOpen] gets a `close(id)` function
 */
export function dialog({title, content = null, message = '', buttons, onOpen = null}) {
    return new Promise(resolve => {
        const win = new Gtk.Window({
            modal: true,
            transient_for: mainWindow,
            resizable: false,
            decorated: false,
            title,
            default_width: 360,
        });
        win.add_css_class('m3-dialog');
        win.add_css_class('m3');

        const body = vbox(16);
        body.margin_top = body.margin_start = body.margin_end = 24;
        body.margin_bottom = 20;
        body.append(label(title, 'm3-dialog-title', {wrap: true}));
        if (message)
            body.append(label(message, 'm3-row-sub', {wrap: true}));
        if (content)
            body.append(content);

        const actions = hbox(8);
        actions.halign = Gtk.Align.END;
        let answer = null;
        const closeWith = id => {
            answer = id;
            win.close();
        };
        for (const b of buttons) {
            const text = new Gtk.Button({label: b.label});
            text.add_css_class('m3-textbtn');
            if (b.variant === 'danger')
                text.add_css_class('danger');
            text.connect('clicked', () => closeWith(b.id));
            actions.append(text);
        }
        body.append(actions);
        win.set_child(body);
        win.connect('close-request', () => {
            resolve(answer);
            return false;
        });
        win.present();
        onOpen?.(win, closeWith);
    });
}

/** Ask for a line of text (or a password); resolves with the text or null. */
export async function askText({title, message = '', placeholder = '', initial = '', password = false,
    okLabel = _('OK')}) {
    const entry = password ? new Gtk.PasswordEntry({show_peek_icon: true}) : new Gtk.Entry();
    entry.add_css_class('m3-entry');
    if (!password) {
        entry.placeholder_text = placeholder;
        entry.text = initial;
    }
    const result = dialog({
        title,
        message,
        content: entry,
        buttons: [
            {id: 'cancel', label: _('Cancel')},
            {id: 'ok', label: okLabel, variant: 'filled'},
        ],
        onOpen: (_win, closeWith) => {
            entry.grab_focus();
            entry.connect('activate', () => closeWith('ok'));
        },
    });
    const answer = await result;
    return answer === 'ok' ? entry.text : null;
}

/** Yes/no question; resolves with a boolean. */
export async function confirm({title, message = '', okLabel = _('OK'), danger = false}) {
    const answer = await dialog({
        title,
        message,
        buttons: [
            {id: 'cancel', label: _('Cancel')},
            {id: 'ok', label: okLabel, variant: danger ? 'danger' : 'filled'},
        ],
    });
    return answer === 'ok';
}

// ---- switches -----------------------------------------------------------

// ---- switch: the HTML's expressive M3 switch, drawn with spring easing ------------

function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const X = t => ((ax * t + bx) * t + cx) * t;
    const Y = t => ((ay * t + by) * t + cy) * t;
    const dX = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
        if (x <= 0)
            return 0;
        if (x >= 1)
            return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
            const err = X(t) - x;
            if (Math.abs(err) < 1e-5)
                break;
            const d = dX(t);
            if (Math.abs(d) < 1e-6)
                break;
            t -= err / d;
        }
        return Y(t);
    };
}

const BOUNCE = bezier(0.34, 1.56, 0.64, 1);
const SPRING = bezier(0.22, 1, 0.36, 1);
// Same properties and timings as the HTML's `.m3-switch` transitions.
const SWITCH_TWEENS = {left: [340, BOUNCE], w: [260, BOUNCE], h: [260, BOUNCE], c: [280, SPRING], s: [160, BOUNCE]};

const mixRgb = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function pill(cr, x, y, w, h) {
    const r = h / 2;
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    cr.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    cr.closePath();
}

export const M3Switch = GObject.registerClass({
    GTypeName: 'M3Switch',
    Properties: {
        active: GObject.ParamSpec.boolean('active', 'Active', 'Whether the switch is on',
            GObject.ParamFlags.READWRITE, false),
    },
    Signals: {'user-toggled': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class M3Switch extends Gtk.DrawingArea {
    _init() {
        super._init({valign: Gtk.Align.CENTER, halign: Gtk.Align.END, focusable: true});
        this._active = false;
        this._pressed = false;
        this._values = {left: 6, w: 16, h: 16, c: 0, s: 0};
        this._tweens = {};
        this._tick = 0;
        this.set_content_width(54);
        this.set_content_height(32);
        this.add_css_class('m3-switch');
        this.set_cursor_from_name('pointer');
        this.set_draw_func((_a, cr, w, h) => this._draw(cr, w, h));
        palette.onChange(() => this.queue_draw());

        const click = new Gtk.GestureClick();
        click.connect('pressed', () => this._press(true));
        click.connect('released', (_g, _n, x, y) => {
            this._press(false);
            if (this.sensitive && x >= 0 && y >= 0 && x <= this.get_width() && y <= this.get_height())
                this._toggleByUser();
        });
        click.connect('cancel', () => this._press(false));
        this.add_controller(click);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval) => {
            if (!this.sensitive || ![Gdk.KEY_space, Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(keyval))
                return false;
            this._toggleByUser();
            return true;
        });
        this.add_controller(keys);
    }

    get active() {
        return this._active;
    }

    set active(value) {
        value = !!value;
        if (value === this._active)
            return;
        this._active = value;
        this._retarget(this.get_mapped());
        this.notify('active');
    }

    _toggleByUser() {
        this.active = !this._active;
        this.emit('user-toggled', this._active);
    }

    _press(down) {
        if (!this.sensitive && down)
            return;
        this._pressed = down;
        this._retarget(true);
    }

    _targets() {
        const a = this._active;
        const p = this._pressed;
        return {
            left: a ? (p ? 19 : 22) : 6,
            w: a ? (p ? 28 : 24) : (p ? 26 : 16),
            h: a ? 24 : 16,
            c: a ? 1 : 0,
            s: p ? 1 : 0,
        };
    }

    _retarget(animate) {
        const target = this._targets();
        const now = GLib.get_monotonic_time() / 1000;
        for (const key of Object.keys(target)) {
            if (!animate) {
                this._values[key] = target[key];
                delete this._tweens[key];
            } else if (this._tweens[key]?.to !== target[key] && this._values[key] !== target[key]) {
                this._tweens[key] = {from: this._values[key], to: target[key], start: now};
            }
        }
        if (!animate) {
            this.queue_draw();
            return;
        }
        if (!this._tick) {
            this._tick = this.add_tick_callback(() => this._step());
        }
    }

    _step() {
        const now = GLib.get_monotonic_time() / 1000;
        for (const [key, tween] of Object.entries(this._tweens)) {
            const [duration, ease] = SWITCH_TWEENS[key];
            const t = Math.min(1, (now - tween.start) / duration);
            this._values[key] = tween.from + (tween.to - tween.from) * ease(t);
            if (t >= 1) {
                this._values[key] = tween.to;
                delete this._tweens[key];
            }
        }
        this.queue_draw();
        if (Object.keys(this._tweens).length === 0) {
            this._tick = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _draw(cr, width, height) {
        const t = palette.t;
        if (!t)
            return;
        const v = this._values;
        const c = Math.max(0, Math.min(1, v.c));
        const highest = unit(t.highest);
        const primary = unit(t.primary);
        const outline = unit(t.outline);
        const onPrimary = unit(t.onPrimary);

        cr.translate(width / 2, height / 2);
        const scale = 1 - 0.08 * v.s;
        cr.scale(scale, scale);
        cr.translate(-width / 2, -height / 2);

        // Track and its 2px border.
        pill(cr, 0, 0, width, height);
        cr.setSourceRGBA(...mixRgb(highest, primary, c), 1);
        cr.fill();
        pill(cr, 1, 1, width - 2, height - 2);
        cr.setSourceRGBA(...mixRgb(outline, primary, c), 1);
        cr.setLineWidth(2);
        cr.stroke();

        // Handle.
        const hx = 2 + v.left;
        const hh = Math.max(1, v.h);
        const hw = Math.max(hh, v.w);
        pill(cr, hx, height / 2 - hh / 2, hw, hh);
        cr.setSourceRGBA(...mixRgb(outline, onPrimary, c), 1);
        cr.fill();

        // Icon: a cross while off, a check while on.
        const cx = hx + hw / 2;
        const cy = height / 2;
        cr.setLineCap(1);
        cr.setLineJoin(1);
        if (c < 0.999) {
            cr.save();
            cr.translate(cx, cy);
            cr.scale(0.8 + 0.2 * (1 - c), 0.8 + 0.2 * (1 - c));
            cr.setSourceRGBA(...highest, 1 - c);
            cr.setLineWidth(1.8);
            cr.moveTo(-3.2, -3.2);
            cr.lineTo(3.2, 3.2);
            cr.moveTo(3.2, -3.2);
            cr.lineTo(-3.2, 3.2);
            cr.stroke();
            cr.restore();
        }
        if (c > 0.001) {
            cr.save();
            cr.translate(cx, cy);
            cr.scale(0.8 + 0.2 * c, 0.8 + 0.2 * c);
            cr.setSourceRGBA(...primary, c);
            cr.setLineWidth(2.2);
            cr.moveTo(-4.4, 0.4);
            cr.lineTo(-1.5, 3.4);
            cr.lineTo(4.6, -3.4);
            cr.stroke();
            cr.restore();
        }
        cr.$dispose();
    }
});

/**
 * Android-style ripple: a wave grows from the press point, clipped to the
 * button's shape, and fades once the press is over. The button must have no
 * padding of its own (put it on `content`) so the wave covers the whole button.
 */
export function addRipple(button, content, {color = () => palette.t?.onSurface, alpha = 0.14} = {}) {
    const overlay = new Gtk.Overlay();
    overlay.set_child(content);
    const area = new Gtk.DrawingArea({can_target: false, hexpand: true, vexpand: true});
    overlay.add_overlay(area);
    overlay.set_clip_overlay(area, true);
    button.set_child(overlay);
    button.overflow = Gtk.Overflow.HIDDEN;

    const waves = [];
    let tick = 0;
    const GROW = 420;
    const FADE = 320;

    const frame = () => {
        const now = GLib.get_monotonic_time() / 1000;
        for (let i = waves.length - 1; i >= 0; i--) {
            const w = waves[i];
            const fadeStart = Math.max(w.released ?? Infinity, w.start + 180);
            if (w.released !== null && now - fadeStart >= FADE)
                waves.splice(i, 1);
        }
        area.queue_draw();
        if (waves.length === 0) {
            tick = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    };

    area.set_draw_func((_a, cr, width, height) => {
        const hex = color();
        if (hex) {
            const now = GLib.get_monotonic_time() / 1000;
            for (const w of waves) {
                const grow = Math.min(1, (now - w.start) / GROW);
                const radius = w.max * (1 - Math.pow(1 - grow, 3));
                const fadeStart = Math.max(w.released ?? Infinity, w.start + 180);
                const fade = w.released === null ? 1 : Math.max(0, 1 - (now - fadeStart) / FADE);
                cr.arc(w.x, w.y, Math.max(0.1, radius), 0, 2 * Math.PI);
                cr.setSourceRGBA(...unit(hex), alpha * fade);
                cr.fill();
            }
        }
        void width;
        void height;
        cr.$dispose();
    });

    const release = () => {
        const now = GLib.get_monotonic_time() / 1000;
        waves.forEach(w => {
            w.released ??= now;
        });
    };
    const click = new Gtk.GestureClick({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    click.connect('pressed', (_g, _n, x, y) => {
        const width = button.get_width();
        const height = button.get_height();
        waves.push({
            x, y, start: GLib.get_monotonic_time() / 1000, released: null,
            max: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)),
        });
        if (!tick)
            tick = button.add_tick_callback(frame);
    });
    click.connect('released', release);
    click.connect('cancel', release);
    button.add_controller(click);
    return button;
}

/** Row with a switch bound to a boolean GSettings key (null if the key is missing). */
export function gsSwitch({schema, key, title, sub = '', icon: iconName = null, invert = false}) {
    if (!gs.has(schema, key))
        return null;
    const settings = gs.settings(schema);
    const toggle = new M3Switch();
    toggle.sensitive = settings.is_writable(key);
    settings.bind(key, toggle, 'active', invert
        ? Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN
        : Gio.SettingsBindFlags.DEFAULT);
    toggle.connect('user-toggled', () => toast());
    const line = row({title, sub, icon: iconName, trailing: toggle});
    line.toggle = toggle;
    return line;
}

/** Row with a switch driven by getters and setters (D-Bus, commands...). */
export function customSwitch({title, sub = '', icon: iconName = null, get, set}) {
    const toggle = new M3Switch();
    toggle.active = !!get();
    // After a click the backend needs a moment to catch up. Refreshes that
    // still report the old state in that window must not flip the switch
    // back, which made it look stuck.
    let pending = null;
    let pendingTimer = 0;
    const clearPending = () => {
        pending = null;
        if (pendingTimer) {
            GLib.source_remove(pendingTimer);
            pendingTimer = 0;
        }
    };
    toggle.connect('user-toggled', (_w, state) => {
        clearPending();
        pending = state;
        pendingTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            pendingTimer = 0;
            pending = null;
            return GLib.SOURCE_REMOVE;
        });
        set(state);
    });
    const line = row({title, sub, icon: iconName, trailing: toggle});
    line.toggle = toggle;
    line.setActive = value => {
        value = !!value;
        if (pending !== null && value !== pending)
            return;
        if (value === pending)
            clearPending();
        toggle.active = value;
    };
    // The caller reports a failed change: show the real state again.
    line.settle = value => {
        clearPending();
        toggle.active = !!value;
    };
    return line;
}

// ---- drop-downs -----------------------------------------------------------

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

/**
 * Pill drop-down (Android 17 style): compact pill trigger with a small
 * triangle that flips while open, and a rounded translucent menu.
 *
 * @returns {{widget: Gtk.MenuButton, select: function(*): void, setOptions: function(Array): void}}
 */
export function dropdown(options, current, onSelect, {search = false} = {}) {
    let list = options;
    let value = current;

    const text = label('', 'm3-dd-value');
    const chevron = new Gtk.DrawingArea({content_width: 10, content_height: 6, valign: Gtk.Align.CENTER});
    let angle = 0;
    let animation = null;
    chevron.set_draw_func((_area, cr, w, h) => {
        const c = palette.t?.onSurface ?? '#ffffff';
        cr.translate(w / 2, h / 2);
        cr.rotate(angle);
        cr.translate(-w / 2, -h / 2);
        cr.moveTo(0, 0.5);
        cr.lineTo(w / 2, h - 0.5);
        cr.lineTo(w, 0.5);
        cr.closePath();
        cr.setSourceRGBA(...unit(c), 0.9);
        cr.fill();
    });
    const flip = open => {
        // Overshooting ease (cubic-bezier .34,1.56,.64,1 in the HTML reference).
        const from = angle;
        const to = open ? Math.PI : 0;
        const start = GLib.get_monotonic_time();
        animation?.remove?.();
        const id = chevron.add_tick_callback(() => {
            const k = Math.min(1, (GLib.get_monotonic_time() - start) / 340000);
            const s = k - 1;
            const eased = 1 + 2.70158 * s * s * s + 1.70158 * s * s;
            angle = from + (to - from) * eased;
            chevron.queue_draw();
            if (k >= 1) {
                angle = to;
                animation = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        animation = {remove: () => chevron.remove_tick_callback(id)};
    };

    const content = hbox(8);
    content.append(text);
    content.append(chevron);

    const widget = new Gtk.MenuButton({valign: Gtk.Align.CENTER, child: content, direction: Gtk.ArrowType.DOWN});
    widget.add_css_class('m3-dd');
    const popover = new Gtk.Popover({has_arrow: false, autohide: true});
    popover.add_css_class('m3-dd');
    popover.add_css_class('m3');
    widget.popover = popover;
    popover.connect('notify::visible', () => {
        const open = popover.visible;
        flip(open);
        if (open)
            widget.add_css_class('open');
        else
            widget.remove_css_class('open');
    });

    const column = vbox(2, 'm3-dd-list');
    const scroller = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER, propagate_natural_height: true, max_content_height: 320,
        propagate_natural_width: true, child: column,
    });
    const body = vbox(6);
    body.set_size_request(144, -1);
    let filter = null;
    if (search) {
        filter = new Gtk.SearchEntry({placeholder_text: _('Search')});
        filter.add_css_class('m3-entry');
        body.append(filter);
    }
    body.append(scroller);
    popover.set_child(body);

    const buttons = [];
    const labelOf = id => list.find(o => same(o.id, id))?.label ?? '';
    const refreshActive = () => {
        text.label = labelOf(value);
        for (const [button, id] of buttons) {
            if (same(id, value))
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
    };
    const rebuild = () => {
        clearBox(column);
        buttons.length = 0;
        for (const option of list) {
            const button = new Gtk.Button({child: label(option.label, '', {xalign: 0})});
            button.add_css_class('m3-dd-item');
            button.connect('clicked', () => {
                value = option.id;
                refreshActive();
                popover.popdown();
                onSelect(option.id);
            });
            column.append(button);
            buttons.push([button, option.id, option.label.toLowerCase()]);
        }
        refreshActive();
    };
    filter?.connect('search-changed', () => {
        const q = filter.text.toLowerCase();
        for (const [button, , name] of buttons)
            button.visible = !q || name.includes(q);
    });
    popover.connect('show', () => {
        if (filter) {
            filter.text = '';
            filter.grab_focus();
        }
        const active = buttons.find(([, id]) => same(id, value))?.[0];
        if (active)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                active.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
    });
    rebuild();

    return {
        widget,
        select(id) {
            value = id;
            refreshActive();
        },
        setOptions(next, keep) {
            list = next;
            value = keep;
            rebuild();
        },
    };
}

/** Row with a drop-down. */
export function selectRow({title, sub = '', icon: iconName = null, options, get, set, search = false}) {
    const picker = dropdown(options, get(), id => {
        set(id);
        toast();
    }, {search});
    const line = row({title, sub, icon: iconName, trailing: picker.widget});
    line.picker = picker;
    line.refresh = () => picker.select(get());
    return line;
}

/** Drop-down row bound to a GSettings key; `options` = [[value, label], ...]. */
export function gsSelect({schema, key, title, sub = '', icon: iconName = null, options}) {
    if (!gs.has(schema, key))
        return null;
    let list = options.map(([id, text]) => ({id, label: text}));
    const current = gs.get(schema, key);
    if (current !== null && !list.some(o => same(o.id, current)))
        list = [{id: current, label: `${current}`}, ...list];
    const line = selectRow({
        title,
        sub,
        icon: iconName,
        options: list,
        get: () => gs.get(schema, key),
        set: value => gs.set(schema, key, value),
    });
    gs.settings(schema).connect(`changed::${key}`, () => line.refresh());
    return line;
}

/** Row with a text entry bound to a string GSettings key. */
export function gsEntry({schema, key, title, sub = '', icon: iconName = null, width = 200}) {
    if (!gs.has(schema, key))
        return null;
    const entry = addClasses(new Gtk.Entry({valign: Gtk.Align.CENTER, width_chars: 16}), 'm3-entry');
    entry.set_size_request(width, -1);
    entry.text = gs.get(schema, key, '') ?? '';
    const commit = () => {
        gs.set(schema, key, entry.text);
        toast();
    };
    entry.connect('activate', commit);
    const focus = new Gtk.EventControllerFocus();
    focus.connect('leave', commit);
    entry.add_controller(focus);
    return row({title, sub, icon: iconName, trailing: entry});
}

/** Row with a font button bound to a string GSettings key. */
export function gsFont({schema, key, title, sub = '', icon: iconName = null}) {
    if (!gs.has(schema, key))
        return null;
    const button = new Gtk.FontDialogButton({
        valign: Gtk.Align.CENTER,
        dialog: new Gtk.FontDialog(),
        level: Gtk.FontLevel.FONT,
    });
    const read = () => Pango.FontDescription.from_string(gs.get(schema, key, 'Sans 11'));
    button.font_desc = read();
    button.connect('notify::font-desc', () => {
        const value = button.font_desc.to_string();
        if (value !== gs.get(schema, key)) {
            gs.set(schema, key, value);
            toast();
        }
    });
    return row({title, sub, icon: iconName, trailing: button});
}

// ---- expressive slider ------------------------------------------------------

function roundedRect(cr, x, y, w, h, [tl, tr, br, bl]) {
    const m = Math.max(0, Math.min(w, h) / 2);
    [tl, tr, br, bl] = [tl, tr, br, bl].map(r => Math.max(0, Math.min(r, m)));
    cr.newSubPath();
    cr.arc(x + tl, y + tl, tl, Math.PI, 1.5 * Math.PI);
    cr.arc(x + w - tr, y + tr, tr, 1.5 * Math.PI, 2 * Math.PI);
    cr.arc(x + w - br, y + h - br, br, 0, 0.5 * Math.PI);
    cr.arc(x + bl, y + h - bl, bl, 0.5 * Math.PI, Math.PI);
    cr.closePath();
}

const rgba = (cr, hex, a = 1) => cr.setSourceRGBA(...unit(hex), a);

/**
 * The reference's expressive gapped slider: split track with a gap around a
 * pill handle that grows on hover and drag, optional step ticks and a bubble
 * with the value. Drawn with cairo so it follows the live palette.
 */
export const ExpSlider = GObject.registerClass({
    Signals: {'value-changed': {param_types: [GObject.TYPE_DOUBLE]}},
}, class M3ExpSlider extends Gtk.DrawingArea {
    _init({min, max, step = 1, value, discrete = false, format = v => `${Math.round(v)}`}) {
        super._init({hexpand: true, valign: Gtk.Align.CENTER, focusable: true, can_focus: true});
        this._min = min;
        this._max = max;
        this._step = step;
        this._discrete = discrete;
        this._format = format;
        this._value = this._snap(value);
        this._hover = false;
        this._drag = false;
        this._cur = {hw: 5, hh: 30, th: 16, tip: 0};
        this._tick = 0;
        this.set_size_request(120, 54);
        this.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));

        const drag = new Gtk.GestureDrag();
        drag.connect('drag-begin', (_g, x) => {
            this._drag = true;
            this.grab_focus();
            this._moveTo(x);
            this._animate();
        });
        drag.connect('drag-update', (g, dx) => {
            const [, sx] = g.get_start_point();
            this._moveTo(sx + dx);
        });
        drag.connect('drag-end', () => {
            this._drag = false;
            this._animate();
        });
        this.add_controller(drag);

        const motion = new Gtk.EventControllerMotion();
        motion.connect('enter', () => {
            this._hover = true;
            this._animate();
        });
        motion.connect('leave', () => {
            this._hover = false;
            this._animate();
        });
        this.add_controller(motion);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval) => {
            const inc = this._discrete ? this._step : Math.max(this._step, (this._max - this._min) / 20);
            if (keyval === 0xff51 || keyval === 0xff54) {
                this.nudge(-inc);
                return true;
            }
            if (keyval === 0xff53 || keyval === 0xff52) {
                this.nudge(inc);
                return true;
            }
            return false;
        });
        this.add_controller(keys);

        // Pages live as long as the window, so the subscription is never dropped.
        palette.onChange(() => this.queue_draw());
    }

    get value() {
        return this._value;
    }

    /** Programmatic change (no signal). */
    setValue(value) {
        this._value = this._snap(value);
        this.queue_draw();
    }

    nudge(delta) {
        this._commit(this._snap(this._value + delta));
    }

    _snap(value) {
        const clamped = Math.max(this._min, Math.min(this._max, value));
        const steps = Math.round((clamped - this._min) / this._step);
        return Math.min(this._max, +(this._min + steps * this._step).toFixed(6));
    }

    _commit(value) {
        if (value === this._value)
            return;
        this._value = value;
        this.queue_draw();
        this.emit('value-changed', value);
    }

    _moveTo(x) {
        const width = this.get_width();
        if (width <= 0)
            return;
        const pct = Math.max(0, Math.min(1, x / width));
        this._commit(this._snap(this._min + pct * (this._max - this._min)));
    }

    _animate() {
        if (this._tick)
            return;
        this._tick = this.add_tick_callback(() => {
            const goal = this._drag ? {hw: 4, hh: 38, th: 18, tip: 1}
                : this._hover ? {hw: 6, hh: 34, th: 16, tip: 1}
                    : {hw: 5, hh: 30, th: 16, tip: 0};
            let done = true;
            for (const key of Object.keys(goal)) {
                const diff = goal[key] - this._cur[key];
                if (Math.abs(diff) > 0.05) {
                    this._cur[key] += diff * 0.35;
                    done = false;
                } else {
                    this._cur[key] = goal[key];
                }
            }
            this.queue_draw();
            if (done) {
                this._tick = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _draw(cr, width, height) {
        const t = palette.t;
        if (!t || width <= 0) {
            cr.$dispose();
            return;
        }
        const pct = (this._value - this._min) / (this._max - this._min);
        const cy = height - 19;
        const th = this._cur.th;
        const gap = 8;
        const x = pct * width;
        const activeW = Math.max(0, x - gap);
        const inactiveW = Math.max(0, width - x - gap);

        // Inactive track (with hairline), then the active one.
        if (inactiveW > 0) {
            roundedRect(cr, width - inactiveW, cy - th / 2, inactiveW, th, [5, th / 2, th / 2, 5]);
            rgba(cr, t.highest);
            cr.fillPreserve();
            rgba(cr, t.outlineVariant);
            cr.setLineWidth(1);
            cr.stroke();
        }
        if (activeW > 0) {
            roundedRect(cr, 0, cy - th / 2, activeW, th, [th / 2, 5, 5, th / 2]);
            rgba(cr, t.primary);
            cr.fill();
        }

        if (this._discrete) {
            const count = Math.round((this._max - this._min) / this._step);
            for (let i = 0; i <= count; i++) {
                const p = i / count;
                if (Math.abs(p - pct) < 0.04)
                    continue;
                const on = p < pct;
                cr.arc(Math.min(width - 2, Math.max(2, p * width)), cy, 2, 0, 2 * Math.PI);
                if (on)
                    rgba(cr, t.onPrimary, 0.85);
                else
                    rgba(cr, t.variant, 0.45);
                cr.fill();
            }
        }

        // Handle.
        const hw = this._cur.hw;
        const hh = this._cur.hh;
        roundedRect(cr, Math.min(width - hw, Math.max(0, x - hw / 2)), cy - hh / 2, hw, hh,
            [hw / 2, hw / 2, hw / 2, hw / 2]);
        rgba(cr, t.primary);
        cr.fill();

        // Value bubble.
        if (this._cur.tip > 0.02) {
            const text = this._format(this._value);
            cr.selectFontFace('monospace', 0, 1);
            cr.setFontSize(11);
            const ext = cr.textExtents(text);
            const bw = ext.width + 20;
            const bh = 20;
            const bx = Math.min(width - bw, Math.max(0, x - bw / 2));
            const by = Math.max(0, cy - hh / 2 - bh - 2);
            roundedRect(cr, bx, by, bw, bh, [10, 10, 10, 10]);
            rgba(cr, t.onSurface, this._cur.tip);
            cr.fill();
            rgba(cr, t.surface, this._cur.tip);
            cr.moveTo(bx + 10, by + bh / 2 + ext.height / 2 - 1);
            cr.showText(text);
        }
        cr.$dispose();
    }
});

/**
 * A titled slider block: title with value badge, the slider with optional
 * flanking step buttons, and a caption.
 *
 * @returns {{widget: Gtk.Box, slider: ExpSlider, setBadge: function(string): void}}
 */
export function sliderBlock({title, caption = '', min, max, step = 1, value, discrete = false,
    leftIcon = null, rightIcon = null, format = v => `${Math.round(v)}`, onChange = null}) {
    const holder = vbox(8);
    const head = hbox(8);
    const caption1 = label(title, 'm3-row-title', {hexpand: true, wrap: true});
    head.append(caption1);
    const pill = badge(format(value));
    pill.valign = Gtk.Align.CENTER;
    head.append(pill);
    holder.append(head);

    const slider = new ExpSlider({min, max, step, value, discrete, format});
    const inc = discrete ? step : Math.max(step, (max - min) / 20);
    const line = hbox(10);
    if (leftIcon)
        line.append(iconButton(leftIcon, () => slider.nudge(-inc)));
    line.append(slider);
    if (rightIcon)
        line.append(iconButton(rightIcon, () => slider.nudge(inc)));
    holder.append(line);

    slider.connect('value-changed', (_s, v) => {
        pill.set_label(format(v));
        onChange?.(v);
    });
    if (caption)
        holder.append(label(caption, 'm3-row-sub', {wrap: true}));

    return {
        widget: holder,
        slider,
        setBadge: text => pill.set_label(text),
        setValue(v) {
            slider.setValue(v);
            pill.set_label(format(slider.value));
        },
    };
}

/** Slider block bound to a numeric GSettings key (value = key * scale). */
export function gsSlider({schema, key, title, caption = '', min, max, step, scale = 1, discrete = false,
    leftIcon = null, rightIcon = null, format = v => `${Math.round(v)}`, integer = false}) {
    if (!gs.has(schema, key))
        return null;
    const read = () => (gs.get(schema, key, min / scale) ?? min / scale) * scale;
    const write = debounce(v => {
        const raw = v / scale;
        gs.set(schema, key, integer ? Math.round(raw) : raw);
    }, 70);
    const block = sliderBlock({
        title, caption, min, max, step, discrete, leftIcon, rightIcon, format,
        value: read(),
        onChange: write,
    });
    gs.settings(schema).connect(`changed::${key}`, () => {
        if (Math.abs(block.slider.value - read()) > 1e-6)
            block.setValue(read());
    });
    return block.widget;
}

// ---- info -------------------------------------------------------------------

/** Label/value pairs, one per line. */
export function infoRows(pairs) {
    const holder = vbox(3);
    pairs.filter(Boolean).forEach(([name, value]) => {
        const line = hbox(12, 'm3-row');
        line.append(label(name, 'm3-row-sub', {hexpand: true}));
        const v = label(value, 'm3-row-title', {xalign: 1, wrap: true, selectable: true});
        v.set_max_width_chars(40);
        line.append(v);
        holder.append(line);
    });
    return addClasses(holder, 'm3-card list');
}

/** Busy indicator row. */
export function spinnerRow(text) {
    const line = hbox(12, 'm3-row');
    const spinner = new Gtk.Spinner({spinning: true});
    line.append(spinner);
    line.append(label(text, 'm3-row-sub'));
    return line;
}

/** Replace every child of a box. */
export function clearBox(holder) {
    let child = holder.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        holder.remove(child);
        child = next;
    }
}

/** Run an async function, logging failures instead of leaving a rejected promise. */
export function fire(promise) {
    Promise.resolve(promise).catch(e => console.error(`material3 settings: ${e.message}\n${e.stack}`));
}

/**
 * Build rows from compact specs (GSettings-backed): see each `t` below.
 * Entries whose schema or key is missing on this system are dropped.
 */
export function rowsFrom(specs) {
    return specs.filter(Boolean).map(spec => {
        switch (spec.t) {
        case 'switch': return gsSwitch(spec);
        case 'select': return gsSelect(spec);
        case 'entry': return gsEntry(spec);
        case 'font': return gsFont(spec);
        case 'slider': {
            const slider = gsSlider(spec);
            if (!slider)
                return null;
            const holder = vbox(0, 'm3-row');
            holder.append(slider);
            return holder;
        }
        default: return spec.widget ?? null;
        }
    }).filter(Boolean);
}

/**
 * Preview of how the monitors sit next to each other. Drag one to the other
 * side of another monitor to rearrange; `onDrop(id, cx, cy)` gets the drop
 * point of the monitor's center in layout coordinates.
 */
export const MonitorArrangement = GObject.registerClass(
class M3MonitorArrangement extends Gtk.DrawingArea {
    /** @param {{getMonitors: function(): Array<{id: string, name: string, detail: string, x: number, y: number, w: number, h: number, primary: boolean}>, onDrop: function(string, number, number): void}} params */
    _init({getMonitors, onDrop}) {
        super._init({hexpand: true, focusable: false});
        this._get = getMonitors;
        this._onDrop = onDrop;
        this._drag = null;
        this.set_size_request(260, 190);
        this.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));

        const drag = new Gtk.GestureDrag();
        drag.connect('drag-begin', (_g, x, y) => {
            const view = this._view(this.get_width(), this.get_height());
            const hit = view.rects.find(r => x >= r.sx && x <= r.sx + r.sw && y >= r.sy && y <= r.sy + r.sh);
            this._drag = hit ? {id: hit.id, dx: 0, dy: 0} : null;
            this.queue_draw();
        });
        drag.connect('drag-update', (_g, dx, dy) => {
            if (!this._drag)
                return;
            this._drag.dx = dx;
            this._drag.dy = dy;
            this.queue_draw();
        });
        drag.connect('drag-end', () => {
            const state = this._drag;
            this._drag = null;
            this.queue_draw();
            if (!state)
                return;
            const view = this._view(this.get_width(), this.get_height());
            const rect = view.rects.find(r => r.id === state.id);
            if (!rect || Math.hypot(state.dx, state.dy) < 8)
                return;
            const cx = (rect.sx + state.dx + rect.sw / 2 - view.ox) / view.scale;
            const cy = (rect.sy + state.dy + rect.sh / 2 - view.oy) / view.scale;
            this._onDrop(state.id, cx, cy);
        });
        this.add_controller(drag);
        palette.onChange(() => this.queue_draw());
    }

    /** Monitors scaled to the widget, centered with room around them. */
    _view(width, height) {
        const monitors = this._get();
        if (monitors.length === 0)
            return {rects: [], scale: 1, ox: 0, oy: 0};
        const pad = 28;
        const minX = Math.min(...monitors.map(m => m.x));
        const minY = Math.min(...monitors.map(m => m.y));
        const maxX = Math.max(...monitors.map(m => m.x + m.w));
        const maxY = Math.max(...monitors.map(m => m.y + m.h));
        // Room to drag a monitor beyond the others: the area is a bit larger than the layout.
        const bw = (maxX - minX) * 1.5;
        const bh = (maxY - minY) * 1.5;
        const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
        const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
        const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;
        return {
            scale, ox, oy,
            rects: monitors.map(m => ({
                ...m, sx: ox + m.x * scale, sy: oy + m.y * scale, sw: m.w * scale, sh: m.h * scale,
            })),
        };
    }

    _draw(cr, width, height) {
        const t = palette.t;
        if (!t || width <= 0) {
            cr.$dispose();
            return;
        }
        roundedRect(cr, 0, 0, width, height, [20, 20, 20, 20]);
        rgba(cr, t.highest);
        cr.fillPreserve();
        rgba(cr, t.outlineVariant);
        cr.setLineWidth(1);
        cr.stroke();

        const view = this._view(width, height);
        // The dragged monitor is painted last, so it is above the others.
        const order = [...view.rects].sort((a, b) => (a.id === this._drag?.id) - (b.id === this._drag?.id));
        for (const r of order) {
            const dragging = this._drag?.id === r.id;
            const x = r.sx + (dragging ? this._drag.dx : 0);
            const y = r.sy + (dragging ? this._drag.dy : 0);
            roundedRect(cr, x, y, r.sw, r.sh, [10, 10, 10, 10]);
            rgba(cr, r.primary ? t.primary : t.primaryContainer, dragging ? 0.85 : 1);
            cr.fillPreserve();
            rgba(cr, r.primary ? t.onPrimary : t.onPrimaryContainer, 0.5);
            cr.setLineWidth(dragging ? 2 : 1);
            cr.stroke();

            const ink = r.primary ? t.onPrimary : t.onPrimaryContainer;
            cr.selectFontFace('sans-serif', 0, 1);
            cr.setFontSize(Math.max(10, Math.min(14, r.sh / 5)));
            const title = cr.textExtents(r.name);
            rgba(cr, ink);
            cr.moveTo(x + (r.sw - title.width) / 2, y + r.sh / 2 - 2);
            cr.showText(r.name);
            cr.selectFontFace('sans-serif', 0, 0);
            cr.setFontSize(Math.max(9, Math.min(12, r.sh / 6)));
            const detail = cr.textExtents(r.detail);
            rgba(cr, ink, 0.8);
            cr.moveTo(x + (r.sw - detail.width) / 2, y + r.sh / 2 + detail.height + 4);
            cr.showText(r.detail);
        }
        cr.$dispose();
    }
});
