import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Ease, lerp, tweenerFor} from './animation.js';
import {px} from './ui.js';
import {symbolIcon, centerBin, textLabel} from './widgets.js';

/**
 * Width and height the actor was last allocated.
 *
 * `actor.width` is not that while a relayout is pending, and the sliders queue
 * one themselves every time they resize their children: it then answers with
 * the preferred width instead (for the handle slider a small placeholder), so
 * a render triggered by a volume or brightness change drew the track at that
 * width and kept it there until the next real allocation.
 *
 * @param {St.Widget} actor
 * @returns {[number, number]}
 */
function allocatedSize(actor) {
    const box = actor.get_allocation_box();
    return [box.x2 - box.x1, box.y2 - box.y1];
}

const FILL_RIGHT_RADIUS = 8;
// Minimum fill width so the thumb and icon always fit inside the fill:
// 13 left padding + 20 icon + 8 gap + 4 thumb + 7 right padding.
const MIN_FILL = 52;
const STEP = 10;
const SCROLL_STEP = 0.02;

const SLIDER_RADIUS = 16;
const SLIDER_RADIUS_PRESSED = 22;
const STEP_RADIUS = 14;
const STEP_RADIUS_PRESSED = 22;

/**
 * Split-capsule slider: [-] [ capsule ] [+].
 *
 * Reference behaviour (`.m3-qs-slider`):
 *  - press and drag anywhere on the capsule to set the value
 *  - while held: radius 16 -> 22 (spring), thumb bar 4x22 -> 3x28 (bounce),
 *    icon scale 1.15 and rotate -8deg (bounce)
 *  - -/+ buttons step by 10; held: scale 0.9 (bounce), radius 14 -> 22
 *  - the fill follows with a 50ms linear transition
 */
class PillSlider {
    /**
     * @param {object} params
     * @param {number} params.min
     * @param {number} params.max
     * @param {function(number): string} params.iconFor icon name for a value
     * @param {object} params.backend object with `value`, `setValue()` and `subscribe()`
     */
    constructor({min, max, iconFor, backend}) {
        this._min = min;
        this._max = max;
        this._iconFor = iconFor;
        this._backend = backend;

        this._value = Math.max(min, Math.min(max, backend.value));
        this._shown = this._value;
        this._dragging = false;
        this._grab = null;
        this._radius = px(SLIDER_RADIUS);
        this._pressT = 0;

        this._wrap = new St.BoxLayout({
            style_class: 'm3-slider-wrap',
            style: `spacing: ${px(6)}px;`,
        });
        this._tweener = tweenerFor(this._wrap);

        const minus = this._stepButton('remove');
        minus.connect('clicked', () => this._step(-STEP));
        this._wrap.add_child(minus);

        this._slider = new St.Widget({
            style_class: 'm3-slider',
            x_expand: true,
            height: px(44),
            reactive: true,
            can_focus: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });

        // Fixed layout: the fill is pinned at (0, 0) and only its width
        // changes, so it always grows/shrinks from the left edge.
        this._fill = new St.BoxLayout({
            style_class: 'm3-slider-fill',
        });
        this._fill.set_position(0, 0);
        this._thumb = new St.Widget({
            style_class: 'm3-slider-thumb',
            width: px(4),
            height: px(22),
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill.add_child(new St.Widget({x_expand: true}));
        this._fill.add_child(this._thumb);
        this._slider.add_child(this._fill);

        this._content = new St.BoxLayout({
            style_class: 'm3-slider-content',
        });
        this._content.set_position(0, 0);
        this._icon = symbolIcon(iconFor(this._value), {
            size: 20,
            filled: true,
            styleClass: 'm3-slider-icon',
        });
        this._badge = textLabel(`${this._value}%`, 'm3-slider-badge');
        // The percentage only shows while the slider is being dragged.
        this._badge.opacity = 0;
        this._content.add_child(this._icon);
        this._content.add_child(new St.Widget({x_expand: true}));
        this._content.add_child(this._badge);
        this._slider.add_child(this._content);

        this._wrap.add_child(this._slider);

        const plus = this._stepButton('add');
        plus.connect('clicked', () => this._step(STEP));
        this._wrap.add_child(plus);

        this._slider.connect('notify::width', () => this._render());
        this._slider.connect('notify::height', () => this._render());
        this._slider.connect('key-press-event', (_actor, event) => this._onKey(event));
        this._connectGestures();

        this._unsubscribe = backend.subscribe(() => this._onBackend());
        this._wrap.connect('destroy', () => {
            this._unsubscribe();
            this._endGrab();
        });
    }

    get actor() {
        return this._wrap;
    }

    /** Re-read the backend (used when the menu opens). */
    sync() {
        this._onBackend();
    }

    _connectGestures() {
        const pan = new Clutter.PanGesture();
        pan.set_begin_threshold(0);
        pan.connect('recognize', () => {
            this._beginDrag();
            this._moveTo(pan.get_centroid().x);
            return Clutter.EVENT_STOP;
        });
        pan.connect('pan-update', () => this._moveTo(pan.get_centroid().x));
        pan.connect('end', () => this._endDrag());
        this._slider.add_action(pan);

        const smooth = new Clutter.ScrollController({
            flags: Clutter.ScrollControllerFlags.PHYSICAL_DIRECTION |
                Clutter.ScrollControllerFlags.SCROLL_HORIZONTAL,
        });
        smooth.connect('scroll', (_c, _sprite, _source, dx) =>
            this._nudge(dx * SCROLL_STEP * (this._max - this._min)));
        this._slider.add_action(smooth);

        const discrete = new Clutter.ScrollController({
            flags: Clutter.ScrollControllerFlags.DISCRETE |
                Clutter.ScrollControllerFlags.SCROLL_VERTICAL,
        });
        discrete.connect('scroll', (_c, _sprite, _source, _dx, dy) =>
            this._nudge(-dy * SCROLL_STEP * (this._max - this._min)));
        this._slider.add_action(discrete);
    }

    _onKey(event) {
        const range = this._max - this._min;
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Left:
        case Clutter.KEY_Down:
            this._step(-STEP);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
        case Clutter.KEY_Up:
            this._step(STEP);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._commit(this._min, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._commit(this._max, true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._nudge(-range / 4);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._nudge(range / 4);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _stepButton(iconName) {
        const button = new St.Button({
            style_class: 'm3-step-btn',
            width: px(34),
            height: px(44),
            can_focus: true,
            reactive: true,
        });
        button.set_child(centerBin(symbolIcon(iconName, {size: 18}), 'm3-step-inner'));
        button.set_pivot_point(0.5, 0.5);

        let scale = 1;
        let radius = px(STEP_RADIUS);
        button.connect('notify::pressed', () => {
            const pressed = button.pressed;
            this._tweener.run(`step-scale-${iconName}`, {
                from: scale,
                to: pressed ? 0.9 : 1,
                duration: 180,
                ease: Ease.bounce,
                onUpdate: v => {
                    scale = v;
                    button.set_scale(v, v);
                },
            });
            this._tweener.run(`step-radius-${iconName}`, {
                from: radius,
                to: px(pressed ? STEP_RADIUS_PRESSED : STEP_RADIUS),
                duration: 200,
                ease: Ease.ease,
                onUpdate: v => {
                    radius = v;
                    button.set_style(`border-radius: ${Math.max(0, v).toFixed(1)}px;`);
                },
            });
        });
        return button;
    }

    _beginDrag() {
        if (this._dragging)
            return;
        this._dragging = true;
        this._grab = global.stage.grab(this._slider);
        this._setPressed(true);
    }

    _endDrag() {
        if (!this._dragging)
            return;
        this._dragging = false;
        this._endGrab();
        this._setPressed(false);
    }

    _endGrab() {
        this._grab?.dismiss();
        this._grab = null;
    }

    _moveTo(x) {
        const minFill = px(MIN_FILL);
        const width = Math.max(allocatedSize(this._slider)[0], minFill + 1);
        const fraction = Math.max(0, Math.min(1, (x - minFill) / (width - minFill)));
        this._commit(this._min + fraction * (this._max - this._min), false);
    }

    _nudge(delta) {
        this._commit(this._value + delta, true);
    }

    _step(delta) {
        this._commit(this._value + delta, true);
    }

    /**
     * @param {number} raw requested value
     * @param {boolean} animate ease the fill (not while dragging)
     */
    _commit(raw, animate) {
        const exact = Math.max(this._min, Math.min(this._max, raw));
        const value = Math.round(exact);
        const changed = value !== this._value;

        if (changed) {
            this._value = value;
            this._backend.setValue(value);
        }

        // While dragging, follow the cursor exactly instead of the rounded value.
        if (!animate)
            this._moveShown(exact, false);
        else if (changed)
            this._moveShown(value, true);
    }

    _onBackend() {
        if (this._dragging)
            return;

        const value = Math.max(this._min, Math.min(this._max, Math.round(this._backend.value)));
        if (value === this._value)
            return;

        this._value = value;
        this._moveShown(value, true);
    }

    /** Reference fill transition: width 0.05s linear. */
    _moveShown(target, animate) {
        if (!animate) {
            this._tweener.cancel('fill');
            this._shown = target;
            this._render();
            return;
        }

        this._tweener.run('fill', {
            from: this._shown,
            to: target,
            duration: 50,
            ease: Ease.linear,
            onUpdate: v => {
                this._shown = v;
                this._render();
            },
        });
    }

    _setPressed(pressed) {
        const target = pressed ? 1 : 0;

        this._tweener.run('radius', {
            from: this._radius,
            to: px(pressed ? SLIDER_RADIUS_PRESSED : SLIDER_RADIUS),
            duration: 220,
            ease: Ease.spring,
            onUpdate: v => {
                this._radius = v;
                this._slider.set_style(`border-radius: ${Math.max(0, v).toFixed(1)}px;`);
                this._render();
            },
        });

        this._tweener.run('thumb', {
            from: this._thumbT ?? 0,
            to: target,
            duration: 200,
            ease: Ease.bounce,
            onUpdate: t => {
                this._thumbT = t;
                this._thumb.set_size(lerp(px(4), px(3), t), lerp(px(22), px(28), t));
            },
        });

        this._tweener.run('badge', {
            from: this._badge.opacity / 255,
            to: target,
            duration: 150,
            ease: Ease.linear,
            onUpdate: t => {
                this._badge.opacity = Math.round(Math.max(0, Math.min(1, t)) * 255);
            },
        });

        this._tweener.run('icon', {
            from: this._pressT,
            to: target,
            duration: 250,
            ease: Ease.bounce,
            onUpdate: t => {
                this._pressT = t;
                const scale = lerp(1, 1.15, t);
                this._icon.set_scale(scale, scale);
                this._icon.rotation_angle_z = -8 * t;
            },
        });
    }

    _render() {
        const [allocatedWidth, allocatedHeight] = allocatedSize(this._slider);
        const trackWidth = allocatedWidth > 0 ? allocatedWidth : px(228);
        const trackHeight = allocatedHeight > 0 ? allocatedHeight : px(44);
        const fraction = (this._shown - this._min) / (this._max - this._min);

        // The fill never gets narrower than MIN_FILL, so at low values it
        // stays a full capsule flush with the track (no shrinking corners)
        // and the icon and thumb always sit inside it. The fill edge still
        // lies exactly under the cursor while dragging.
        const minFill = px(MIN_FILL);
        const fillWidth = minFill + (trackWidth - minFill) * fraction;
        const left = this._radius.toFixed(1);

        this._fill.visible = true;
        this._fill.set_style(`border-radius: ${left}px ${px(FILL_RIGHT_RADIUS)}px ` +
            `${px(FILL_RIGHT_RADIUS)}px ${left}px;`);
        this._fill.set_size(Math.round(fillWidth), trackHeight);
        this._content.set_size(trackWidth, trackHeight);

        const shown = Math.round(this._shown);
        this._badge.set_text(`${shown}%`);
        this._icon.set_text(this._iconFor(shown));
    }
}

const HS_TRACK = 36;
const HS_HEIGHT = 44;
const HS_GAP = 4;
const HS_THUMB = 4;
const HS_BUTTON = 44;

/**
 * Expressive "handle" slider: a thick track split by a vertical handle with
 * a small gap on both sides, and round buttons after it instead of -/+.
 */
class HandleSlider {
    /**
     * @param {object} params
     * @param {Array<{iconFor: function(number): string, onClick: ?function(): void}>} [params.trailing]
     */
    constructor({min, max, iconFor, backend, trailing = null, slots = 1}) {
        this._min = min;
        this._max = max;
        this._backend = backend;
        this._value = Math.max(min, Math.min(max, backend.value));
        this._shown = this._value;
        this._dragging = false;
        this._grab = null;

        this._wrap = new St.BoxLayout({style_class: 'm3-slider-wrap', style: `spacing: ${px(8)}px;`});
        this._tweener = tweenerFor(this._wrap);

        // The children are positioned by hand, so the track would otherwise ask
        // for as much width as it last had and push the buttons out of the card.
        this._slider = new St.Widget({
            x_expand: true,
            height: px(HS_HEIGHT),
            min_width: 0,
            natural_width: px(80),
            reactive: true,
            can_focus: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._fill = new St.Widget({style_class: 'm3-hs-fill'});
        this._rest = new St.Widget({style_class: 'm3-hs-rest'});
        this._thumb = new St.Widget({style_class: 'm3-hs-thumb'});
        for (const actor of [this._fill, this._rest, this._thumb])
            this._slider.add_child(actor);
        this._wrap.add_child(this._slider);

        this._buttons = [];
        for (const item of trailing ?? [{iconFor, onClick: null}]) {
            const button = new St.Button({
                style_class: 'm3-hs-btn',
                width: px(HS_BUTTON),
                height: px(HS_BUTTON),
                can_focus: !!item.onClick,
                reactive: !!item.onClick,
            });
            const icon = symbolIcon(item.iconFor(this._value), {size: 20, filled: true});
            button.set_child(centerBin(icon, 'm3-step-inner'));
            button.connect('clicked', () => item.onClick?.());
            this._buttons.push({icon, item});
            this._wrap.add_child(button);
        }
        // Empty slots keep every slider's track the same length.
        for (let i = this._buttons.length; i < slots; i++)
            this._wrap.add_child(new St.Widget({width: px(HS_BUTTON), height: px(HS_BUTTON)}));

        this._slider.connect('notify::width', () => this._render());
        this._slider.connect('key-press-event', (_actor, event) => this._onKey(event));
        this._connectGestures();
        this._unsubscribe = backend.subscribe(() => this._onBackend());
        this._wrap.connect('destroy', () => {
            this._unsubscribe();
            this._grab?.dismiss();
            this._grab = null;
        });
        this._render();
    }

    get actor() {
        return this._wrap;
    }

    sync() {
        this._onBackend();
    }

    _connectGestures() {
        const pan = new Clutter.PanGesture();
        pan.set_begin_threshold(0);
        pan.connect('recognize', () => {
            if (!this._dragging) {
                this._dragging = true;
                this._grab = global.stage.grab(this._slider);
            }
            this._moveTo(pan.get_centroid().x);
            return Clutter.EVENT_STOP;
        });
        pan.connect('pan-update', () => this._moveTo(pan.get_centroid().x));
        pan.connect('end', () => {
            this._dragging = false;
            this._grab?.dismiss();
            this._grab = null;
        });
        this._slider.add_action(pan);

        const discrete = new Clutter.ScrollController({
            flags: Clutter.ScrollControllerFlags.DISCRETE | Clutter.ScrollControllerFlags.SCROLL_VERTICAL,
        });
        discrete.connect('scroll', (_c, _sprite, _source, _dx, dy) =>
            this._commit(this._value - dy * SCROLL_STEP * (this._max - this._min)));
        this._slider.add_action(discrete);
    }

    _onKey(event) {
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Left:
        case Clutter.KEY_Down:
            this._commit(this._value - STEP);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
        case Clutter.KEY_Up:
            this._commit(this._value + STEP);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _moveTo(x) {
        const width = Math.max(1, allocatedSize(this._slider)[0]);
        const fraction = Math.max(0, Math.min(1, x / width));
        this._commit(this._min + fraction * (this._max - this._min));
    }

    _commit(raw) {
        const exact = Math.max(this._min, Math.min(this._max, raw));
        const value = Math.round(exact);
        if (value !== this._value) {
            this._value = value;
            this._backend.setValue(value);
        }
        this._shown = exact;
        this._render();
    }

    _onBackend() {
        if (this._dragging)
            return;
        const value = Math.max(this._min, Math.min(this._max, Math.round(this._backend.value)));
        this._value = value;
        this._shown = value;
        this._render();
    }

    _render() {
        const allocatedWidth = allocatedSize(this._slider)[0];
        const width = allocatedWidth > 0 ? allocatedWidth : px(228);
        const track = px(HS_TRACK);
        const top = Math.round((px(HS_HEIGHT) - track) / 2);
        const thumbW = px(HS_THUMB);
        const gap = px(HS_GAP);
        const fraction = (this._shown - this._min) / (this._max - this._min);
        const thumbX = Math.round(fraction * (width - thumbW));
        const big = Math.round(track / 2);
        const small = px(4);

        const fillW = Math.max(0, thumbX - gap);
        const restX = thumbX + thumbW + gap;
        const restW = Math.max(0, width - restX);

        this._fill.visible = fillW > 0;
        this._fill.set_position(0, top);
        this._fill.set_size(fillW, track);
        this._fill.set_style(`border-radius: ${Math.min(big, fillW / 2)}px ${small}px ${small}px ${Math.min(big, fillW / 2)}px;`);
        this._rest.visible = restW > 0;
        this._rest.set_position(restX, top);
        this._rest.set_size(restW, track);
        this._rest.set_style(`border-radius: ${small}px ${Math.min(big, restW / 2)}px ${Math.min(big, restW / 2)}px ${small}px;`);
        this._thumb.set_position(thumbX, 0);
        this._thumb.set_size(thumbW, px(HS_HEIGHT));
        this._thumb.set_style(`border-radius: ${px(2)}px;`);

        const shown = Math.round(this._shown);
        for (const {icon, item} of this._buttons)
            icon.set_text(item.iconFor(shown));
    }
}

/**
 * Grouped `surface` card containing the brightness and volume sliders.
 *
 * @param {Array<object>} sliders
 * @returns {{actor: St.BoxLayout, sliders: Array<PillSlider>}}
 */
export function buildSliderGroup(sliders, {style = 'classic'} = {}) {
    const card = new St.BoxLayout({
        style_class: 'm3-slider-card',
        orientation: Clutter.Orientation.VERTICAL,
        style: `spacing: ${px(10)}px;`,
    });

    const slots = Math.max(...sliders.map(c => c.trailing?.length ?? 1));
    const instances = sliders.map(config => {
        const slider = style === 'handle' ? new HandleSlider({...config, slots}) : new PillSlider(config);
        card.add_child(slider.actor);
        return slider;
    });

    return {actor: card, sliders: instances};
}
