import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Ease, tweenerFor} from './animation.js';
import {px} from './ui.js';

/**
 * @param {string} text
 * @param {string} styleClass
 * @param {object} params
 * @returns {St.Label}
 */
export function textLabel(text, styleClass, params = {}) {
    const label = new St.Label({
        text,
        style_class: `m3-text ${styleClass}`.trim(),
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
    return label;
}

/**
 * Make a single-line ellipsized label with a fixed width.
 *
 * @param {string} text
 * @param {string} styleClass
 * @param {number} width
 * @returns {St.Label}
 */
export function truncatedLabel(text, styleClass, width) {
    const label = textLabel(text, styleClass);
    label.clutter_text.set_single_line_mode(true);
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    label.width = px(width);
    return label;
}

/**
 * Material Symbols ligature label.
 *
 * @param {string} name icon ligature name, e.g. "wifi"
 * @param {object} options
 * @param {number} [options.size] font size in px
 * @param {boolean} [options.filled] use the FILL=1 instance
 * @param {string} [options.styleClass]
 * @returns {St.Label}
 */
export function symbolIcon(name, {size = 22, filled = false, styleClass = ''} = {}) {
    const family = filled
        ? 'Material Symbols Rounded Filled'
        : 'Material Symbols Rounded';

    const label = new St.Label({
        text: name,
        style_class: `m3-symbol ${styleClass}`.trim(),
        y_align: Clutter.ActorAlign.CENTER,
    });
    label._m3BaseStyle = `font-family: "${family}"; font-size: ${px(size)}px;`;
    label.set_style(label._m3BaseStyle);
    label.set_pivot_point(0.5, 0.5);
    return label;
}

/**
 * Add inline style on top of a symbol's font style without losing it.
 *
 * @param {St.Label} label a label from symbolIcon()
 * @param {string} extra
 */
export function styleSymbol(label, extra) {
    label.set_style(`${label._m3BaseStyle ?? ''} ${extra}`);
}

/**
 * @param {Clutter.Actor} child
 * @param {string} styleClass
 * @param {object} params
 * @returns {St.Bin}
 */
export function centerBin(child, styleClass, params = {}) {
    child.x_align = Clutter.ActorAlign.CENTER;
    child.y_align = Clutter.ActorAlign.CENTER;
    return new St.Bin({
        style_class: styleClass,
        child,
        ...params,
    });
}

/**
 * Reference `.m3-btn:active { transform: scale(0.95) }` with the bounce
 * curve, applied while the button is held down.
 *
 * @param {St.Button} button
 * @param {object} [options]
 * @param {number} [options.scale]
 * @param {number} [options.duration]
 */
export function pressFeedback(button, {scale = 0.95, duration = 160} = {}) {
    const tweener = tweenerFor(button);
    let current = 1;

    button.set_pivot_point(0.5, 0.5);
    button.connect('notify::pressed', () => {
        tweener.run('press', {
            from: current,
            to: button.pressed ? scale : 1,
            duration,
            ease: Ease.bounce,
            onUpdate: value => {
                current = value;
                button.set_scale(value, value);
            },
        });
    });
}

/**
 * Square icon button.
 *
 * @param {string} name
 * @param {object} options
 * @returns {St.Button}
 */
export function iconButton(name, {size = 19, filled = false, styleClass = '', buttonSize = 36} = {}) {
    const button = new St.Button({
        style_class: `m3-icon-btn ${styleClass}`.trim(),
        width: px(buttonSize),
        height: px(buttonSize),
        can_focus: true,
        reactive: true,
    });
    button.set_child(centerBin(symbolIcon(name, {size, filled}), 'm3-icon-btn-inner'));
    pressFeedback(button);
    return button;
}
