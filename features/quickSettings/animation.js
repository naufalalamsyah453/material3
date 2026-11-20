import GLib from 'gi://GLib';

/*
 * Animation primitives that mirror the reference HTML.
 *
 * St can only crossfade CSS changes (transition-duration), it cannot
 * interpolate border-radius or overshoot. The reference relies on
 * cubic-bezier "spring" and "bounce" curves, so the exact same curves are
 * evaluated here and applied frame by frame.
 */

const FRAME_MS = 16;

/**
 * CSS cubic-bezier(x1, y1, x2, y2) as an easing function. Output may leave
 * the 0..1 range, which is what gives the bounce curve its overshoot.
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {function(number): number}
 */
export function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const sampleX = t => ((ax * t + bx) * t + cx) * t;
    const sampleY = t => ((ay * t + by) * t + cy) * t;
    const slopeX = t => (3 * ax * t + 2 * bx) * t + cx;

    const solveX = x => {
        let t = x;
        for (let i = 0; i < 8; i++) {
            const err = sampleX(t) - x;
            if (Math.abs(err) < 1e-6)
                return t;
            const slope = slopeX(t);
            if (Math.abs(slope) < 1e-6)
                break;
            t -= err / slope;
        }

        let lo = 0;
        let hi = 1;
        t = x;
        while (lo < hi) {
            const err = sampleX(t);
            if (Math.abs(err - x) < 1e-6)
                return t;
            if (x > err)
                lo = t;
            else
                hi = t;
            t = (hi - lo) / 2 + lo;
            if (hi - lo < 1e-7)
                break;
        }
        return t;
    };

    return x => {
        if (x <= 0)
            return 0;
        if (x >= 1)
            return 1;
        return sampleY(solveX(x));
    };
}

/** The curves declared in the reference :root block, plus CSS `ease`. */
export const Ease = {
    linear: t => t,
    ease: cubicBezier(0.25, 0.1, 0.25, 1),
    spring: cubicBezier(0.22, 1, 0.36, 1),
    bounce: cubicBezier(0.34, 1.56, 0.64, 1),
};

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * @param {Array<number>} a [r, g, b, a]
 * @param {Array<number>} b [r, g, b, a]
 * @param {number} t
 * @returns {string} CSS color
 */
export function mixColor(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    const r = Math.round(lerp(a[0], b[0], k));
    const g = Math.round(lerp(a[1], b[1], k));
    const bl = Math.round(lerp(a[2], b[2], k));
    const al = lerp(a[3], b[3], k).toFixed(3);
    return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

/**
 * Keyed set of running tweens. Starting a tween on a key that is already
 * running replaces it, so callers can retarget mid-flight (a fast double
 * click still ends in the right state).
 */
export class Tweener {
    constructor() {
        this._sources = new Map();
    }

    /**
     * @param {string} key
     * @param {object} params
     * @param {number} params.from
     * @param {number} params.to
     * @param {number} params.duration milliseconds
     * @param {function(number): number} [params.ease]
     * @param {function(number): void} params.onUpdate
     * @param {function(): void} [params.onComplete]
     */
    run(key, {from, to, duration, ease = Ease.ease, onUpdate, onComplete}) {
        this.cancel(key);

        if (duration <= 0 || from === to) {
            onUpdate(to);
            onComplete?.();
            return;
        }

        const start = GLib.get_monotonic_time();
        onUpdate(from);

        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            const elapsed = (GLib.get_monotonic_time() - start) / 1000;
            const t = Math.min(1, elapsed / duration);

            onUpdate(lerp(from, to, ease(t)));

            if (t < 1)
                return GLib.SOURCE_CONTINUE;

            this._sources.delete(key);
            onComplete?.();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, `[material3] tween ${key}`);
        this._sources.set(key, id);
    }

    /** @param {string} key */
    cancel(key) {
        const id = this._sources.get(key);
        if (id === undefined)
            return;
        this._sources.delete(key);
        GLib.source_remove(id);
    }

    destroy() {
        for (const id of this._sources.values())
            GLib.source_remove(id);
        this._sources.clear();
    }
}

/**
 * Tweener whose lifetime follows an actor.
 *
 * @param {Clutter.Actor} actor
 * @returns {Tweener}
 */
export function tweenerFor(actor) {
    const tweener = new Tweener();
    actor.connect('destroy', () => tweener.destroy());
    return tweener;
}
