/**
 * Shared UI tuning for the Quick Settings surface: a size scale (applied to
 * every pixel size, in JS and in the stylesheet) and an optional text font.
 * The panel sets these from the extension settings before it builds widgets.
 */
export const ui = {
    scale: 1,
    fontScale: 1,
    font: '',
    // Font of the right-click menus; empty follows `font`.
    ctxFont: '',
    // Right-click menus: extra size, extra text size, entry icons.
    ctx: 1,
    ctxFontScale: 1,
    ctxIcons: true,
    // Extra scale of the dock and of the app menu, on top of `scale`.
    dock: 1,
    menu: 1,
    // Scale factor of the surface being built (see scoped()).
    factor: 1,
};

export const SCALE_RANGE = {min: 0.75, max: 1.5};
export const FONT_SCALE_RANGE = {min: 0.8, max: 1.4};

/** Scale a layout size in px. */
export function px(value) {
    return Math.round(value * ui.scale * ui.factor);
}

/**
 * Run `callback` with sizes scaled for one surface: widgets created inside
 * use that surface's own scale ('dock' or 'menu') on top of the UI scale.
 *
 * @param {string} surface dock | menu
 * @param {function(): *} callback
 * @returns {*}
 */
export function scoped(surface, callback) {
    const previous = ui.factor;
    ui.factor = surface === 'ctx' ? ui.menu * ui.ctx : ui[surface] ?? 1;
    try {
        return callback();
    } finally {
        ui.factor = previous;
    }
}

/** Scale a text size in px (UI scale times the font size factor). */
export function fontPx(value) {
    return Math.round(value * ui.scale * ui.factor * ui.fontScale * 10) / 10;
}

/**
 * Read the tuning from the extension settings.
 *
 * @param {Gio.Settings} settings
 */
export function loadUi(settings) {
    const clamp = (v, {min, max}) => Math.max(min, Math.min(max, v));
    ui.scale = clamp(settings.get_double('ui-scale'), SCALE_RANGE);
    ui.fontScale = clamp(settings.get_double('font-scale'), FONT_SCALE_RANGE);
    ui.dock = clamp(settings.get_double('dock-scale'), {min: 0.7, max: 1.6});
    ui.menu = clamp(settings.get_double('appmenu-scale'), {min: 0.7, max: 1.5});
    ui.font = settings.get_string('font-family').replace(/["';{}\\]/g, '').trim();
    const has = key => settings.settings_schema.has_key(key);
    ui.ctx = has('context-scale') ? clamp(settings.get_double('context-scale'), {min: 0.7, max: 1.6}) : 1;
    ui.ctxFontScale = has('context-font-scale')
        ? clamp(settings.get_double('context-font-scale'), {min: 0.7, max: 1.6}) : 1;
    ui.ctxIcons = has('context-show-icons') ? settings.get_boolean('context-show-icons') : true;
    // A schema compiled before this key existed must not break the rest.
    ui.ctxFont = settings.settings_schema.has_key('context-font-family')
        ? settings.get_string('context-font-family').replace(/["';{}\\]/g, '').trim()
        : '';
}

/** True when the stylesheet needs the scale/font override layer. */
export function uiIsCustom() {
    return ui.scale !== 1 || ui.fontScale !== 1 || ui.font !== '' || ui.ctxFont !== '' || ui.dock !== 1 || ui.menu !== 1 ||
        ui.ctx !== 1 || ui.ctxFontScale !== 1;
}
