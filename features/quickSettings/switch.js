import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {px} from './ui.js';

// Geometry of the Settings app switch (app/ui.js M3Switch), drawn the same way.
const WIDTH = 54;
const HEIGHT = 32;
const TWEEN_MS = 220;

function targets(active, pressed) {
    return {
        left: active ? (pressed ? 19 : 22) : 6,
        w: active ? (pressed ? 28 : 24) : (pressed ? 26 : 16),
        h: active ? 24 : 16,
        c: active ? 1 : 0,
        s: pressed ? 1 : 0,
    };
}

const easeOut = t => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * The extension's one on/off switch: pill track, a handle that grows and
 * slides right, a cross when off and a check when on. It is painted with
 * cairo, so it is pixel-identical to the Settings app switch; the colors come
 * from the `.m3-switch` rules (an `m3-qs` ancestor is needed).
 *
 * @param {object} [params]
 * @param {function(): void} [params.onClicked] the owner decides the new state
 * @returns {St.Button} with `setActive(on, animate)` and `active`
 */
export function createSwitch({onClicked = null} = {}) {
    const button = new St.Button({
        can_focus: true,
        reactive: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
        width: px(WIDTH),
        height: px(HEIGHT),
    });
    const holder = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true,
        width: px(WIDTH), height: px(HEIGHT)});
    // Invisible twins that only carry the themed CSS colors: one per state, each
    // with a handle child (`.m3-switch.active .m3-switch-thumb` is a descendant rule).
    const makeProbe = active => {
        const track = new St.Widget({style_class: active ? 'm3-switch active' : 'm3-switch', width: 1, height: 1,
            opacity: 0, reactive: false, layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START});
        const handle = new St.Widget({style_class: 'm3-switch-thumb', width: 1, height: 1});
        track.add_child(handle);
        return {track, handle};
    };
    const probeOff = makeProbe(false);
    const probeOn = makeProbe(true);
    const area = new St.DrawingArea({x_expand: true, y_expand: true, reactive: false,
        width: px(WIDTH), height: px(HEIGHT)});
    holder.add_child(area);
    holder.add_child(probeOff.track);
    holder.add_child(probeOn.track);
    button.set_child(holder);
    button.connect('clicked', () => onClicked?.());

    let values = targets(false, false);
    let from = values;
    let goal = values;
    let timeline = null;

    // Cogl colors carry 0-255 channels; accept 0-1 floats as well.
    const channel = v => (v > 1 ? v / 255 : v);
    const toRgb = c => [channel(c.red), channel(c.green), channel(c.blue)];
    let warned = false;
    const colors = () => {
        const read = probe => {
            const node = probe.track.get_theme_node();
            return {
                fill: toRgb(node.get_background_color()),
                border: toRgb(node.get_border_color(St.Side.TOP)),
                handle: toRgb(probe.handle.get_theme_node().get_background_color()),
            };
        };
        try {
            return {off: read(probeOff), on: read(probeOn)};
        } catch (e) {
            if (!warned) {
                console.error(`material3: switch colors: ${e.message}`);
                warned = true;
            }
            const off = {fill: [0.21, 0.2, 0.23], border: [0.79, 0.77, 0.82], handle: [0.79, 0.77, 0.82]};
            const on = {fill: [0.82, 0.74, 1], border: [0.82, 0.74, 1], handle: [0.22, 0.12, 0.45]};
            return {off, on};
        }
    };

    area.connect('repaint', () => {
        const cr = area.get_context();
        try {
            paint(cr);
        } catch (e) {
            console.error(`material3: switch paint: ${e.message}`);
        }
        cr.$dispose();
    });

    const paint = cr => {
        const [w] = area.get_surface_size();
        const k = w / WIDTH;
        const c = Math.max(0, Math.min(1, values.c));
        const {off, on} = colors();
        const trackFill = mix(off.fill, on.fill, c);
        const trackBorder = mix(off.border, on.border, c);
        const handleColor = mix(off.handle, on.handle, c);
        // The cross is drawn in the off fill, the check in the on fill.
        const crossColor = off.fill;
        const checkColor = on.fill;

        cr.scale(k, k);
        cr.translate(WIDTH / 2, HEIGHT / 2);
        const scale = 1 - 0.08 * values.s;
        cr.scale(scale, scale);
        cr.translate(-WIDTH / 2, -HEIGHT / 2);

        const pill = (x, y, pw, ph) => {
            const r = ph / 2;
            cr.newSubPath();
            cr.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
            cr.arc(x + pw - r, y + r, r, Math.PI * 1.5, Math.PI * 2.5);
            cr.closePath();
        };

        pill(0, 0, WIDTH, HEIGHT);
        cr.setSourceRGBA(trackFill[0], trackFill[1], trackFill[2], 1);
        cr.fill();
        pill(1, 1, WIDTH - 2, HEIGHT - 2);
        cr.setSourceRGBA(trackBorder[0], trackBorder[1], trackBorder[2], 1);
        cr.setLineWidth(2);
        cr.stroke();

        const hx = 2 + values.left;
        const hh = Math.max(1, values.h);
        const hw = Math.max(hh, values.w);
        pill(hx, HEIGHT / 2 - hh / 2, hw, hh);
        cr.setSourceRGBA(handleColor[0], handleColor[1], handleColor[2], 1);
        cr.fill();

        const cx = hx + hw / 2;
        const cy = HEIGHT / 2;
        cr.setLineCap(1);
        cr.setLineJoin(1);
        if (c < 0.999) {
            cr.save();
            cr.translate(cx, cy);
            const s = 0.8 + 0.2 * (1 - c);
            cr.scale(s, s);
            cr.setSourceRGBA(crossColor[0], crossColor[1], crossColor[2], 1 - c);
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
            const s = 0.8 + 0.2 * c;
            cr.scale(s, s);
            cr.setSourceRGBA(checkColor[0], checkColor[1], checkColor[2], c);
            cr.setLineWidth(2.2);
            cr.moveTo(-4.4, 0.4);
            cr.lineTo(-1.5, 3.4);
            cr.lineTo(4.6, -3.4);
            cr.stroke();
            cr.restore();
        }
    };

    const retarget = animate => {
        goal = targets(button.active === true, button.pressed);
        timeline?.stop();
        timeline = null;
        if (!animate || !area.mapped) {
            values = goal;
            area.queue_repaint();
            return;
        }
        from = {...values};
        timeline = new Clutter.Timeline({actor: area, duration: TWEEN_MS});
        timeline.connect('new-frame', () => {
            const t = easeOut(timeline.get_progress());
            values = Object.fromEntries(Object.keys(goal).map(key => [key, from[key] + (goal[key] - from[key]) * t]));
            area.queue_repaint();
        });
        timeline.connect('completed', () => {
            values = goal;
            area.queue_repaint();
        });
        timeline.start();
    };

    probeOff.track.connect('style-changed', () => area.queue_repaint());
    probeOn.track.connect('style-changed', () => area.queue_repaint());
    button.connect('notify::pressed', () => retarget(true));
    button.connect('destroy', () => timeline?.stop());

    button.active = null;
    button.setActive = (on, animate = false) => {
        if (button.active === on)
            return;
        const first = button.active === null;
        button.active = on;
        retarget(animate && !first);
    };
    return button;
}
