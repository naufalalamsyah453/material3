import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const GROW_MS = 420;
const FADE_MS = 320;
const HOLD_MS = 180; // the wave keeps spreading at least this long before it fades
const FRAME_MS = 16;

const now = () => GLib.get_monotonic_time() / 1000;

/**
 * Android-style touch ripple for a shell widget. A wave spreads from the
 * press point, clipped to the (rounded) shape of the widget, and fades once
 * the press is over. Drawn with cairo so the corners are clipped properly.
 */
export class Ripple {
    /**
     * @param {object} options
     * @param {St.Widget} options.parent container the wave is drawn in (below the content)
     * @param {Clutter.Actor} options.source actor that receives the presses
     * @param {function(): number[]} options.radii [topLeft, topRight, bottomRight, bottomLeft] in px
     * @param {function(): number[]} options.color [r, g, b, a] with r, g, b in 0..1
     * @param {function(): ?number[]} [options.exclude] [x, y, width, height, radius] left untouched (e.g. an icon chip)
     */
    constructor({parent, source, radii, color, exclude = null}) {
        this._exclude = exclude;
        this._hover = {value: 0, from: 0, to: 0, start: 0};
        this._radii = radii;
        this._color = color;
        this._waves = [];
        this._timeoutId = 0;

        this.actor = new St.DrawingArea({x_expand: true, y_expand: true, reactive: false});
        parent.add_child(this.actor);
        this._repaintId = this.actor.connect('repaint', () => this._paint());

        this._ids = [
            [source, source.connect('button-press-event', (_a, event) => {
                this._press(event);
                return Clutter.EVENT_PROPAGATE;
            })],
            [source, source.connect('button-release-event', () => {
                this._release();
                return Clutter.EVENT_PROPAGATE;
            })],
            [source, source.connect('leave-event', () => {
                this._release();
                return Clutter.EVENT_PROPAGATE;
            })],
        ];
        this.actor.connect('destroy', () => this.destroy());
    }

    destroy() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        for (const [object, id] of this._ids ?? []) {
            try {
                object.disconnect(id);
            } catch {
                // Source already gone.
            }
        }
        this._ids = [];
        this._waves = [];
    }

    /** Fade the hover layer (the whole shape, minus the excluded area) in or out. */
    setHover(on) {
        const t = now();
        const current = this._hoverValue(t);
        this._hover = {value: current, from: current, to: on ? 1 : 0, start: t};
        this._ensureTimer();
    }

    _hoverValue(t) {
        const h = this._hover;
        const k = Math.min(1, (t - h.start) / 140);
        return h.from + (h.to - h.from) * k;
    }

    _ensureTimer() {
        if (!this._timeoutId)
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => this._frame());
    }

    _press(event) {
        const [stageX, stageY] = event.get_coords();
        const [ok, x, y] = this.actor.transform_stage_point(stageX, stageY);
        const [width, height] = this.actor.get_size();
        if (!ok || width <= 0)
            return;
        this._waves.push({
            x, y,
            start: now(),
            released: null,
            max: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)),
        });
        this._ensureTimer();
    }

    _release() {
        const t = now();
        for (const wave of this._waves)
            wave.released ??= t;
    }

    _fadeStart(wave) {
        return Math.max(wave.released ?? Infinity, wave.start + HOLD_MS);
    }

    _frame() {
        const t = now();
        this._waves = this._waves.filter(w => w.released === null || t - this._fadeStart(w) < FADE_MS);
        this.actor.queue_repaint();
        const hoverBusy = t - this._hover.start < 140;
        if (this._waves.length === 0 && !hoverBusy) {
            this._timeoutId = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _paint() {
        const cr = this.actor.get_context();
        const [width, height] = this.actor.get_surface_size();
        const hover = this._hoverValue(now());
        if ((this._waves.length > 0 || hover > 0.001) && width > 0) {
            const [tl, tr, br, bl] = this._radii().map(r => Math.max(0, Math.min(r, height / 2, width / 2)));
            cr.newSubPath();
            cr.arc(width - tr, tr, tr, -Math.PI / 2, 0);
            cr.arc(width - br, height - br, br, 0, Math.PI / 2);
            cr.arc(bl, height - bl, bl, Math.PI / 2, Math.PI);
            cr.arc(tl, tl, tl, Math.PI, Math.PI * 1.5);
            cr.closePath();
            const hole = this._exclude?.();
            if (hole) {
                const [hx, hy, hw, hh, hr0] = hole;
                const hr = Math.min(hr0, hw / 2, hh / 2);
                cr.newSubPath();
                cr.arc(hx + hw - hr, hy + hr, hr, -Math.PI / 2, 0);
                cr.arc(hx + hw - hr, hy + hh - hr, hr, 0, Math.PI / 2);
                cr.arc(hx + hr, hy + hh - hr, hr, Math.PI / 2, Math.PI);
                cr.arc(hx + hr, hy + hr, hr, Math.PI, Math.PI * 1.5);
                cr.closePath();
                cr.setFillRule(1); // even-odd: the hole stays clear
            }
            cr.clip();

            const [r, g, b, a] = this._color();
            if (hover > 0.001) {
                cr.rectangle(0, 0, width, height);
                cr.setSourceRGBA(r, g, b, a * 0.5 * hover);
                cr.fill();
            }
            const t = now();
            for (const wave of this._waves) {
                const grow = Math.min(1, (t - wave.start) / GROW_MS);
                const radius = wave.max * (1 - Math.pow(1 - grow, 3));
                const fade = wave.released === null
                    ? 1
                    : Math.max(0, 1 - (t - this._fadeStart(wave)) / FADE_MS);
                cr.arc(wave.x, wave.y, Math.max(0.1, radius), 0, 2 * Math.PI);
                cr.setSourceRGBA(r, g, b, a * fade);
                cr.fill();
            }
        }
        cr.$dispose();
    }
}
