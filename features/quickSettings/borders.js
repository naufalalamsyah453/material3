import {THEMES} from './themes.js';

const COLOR = {
    outline: t => t.outlineVariant,
    primary: t => t.primary,
    secondary: t => t.onSecondaryContainer,
    text: t => t.variant,
};

/** Border settings of a surface: width, radius and the color in light and dark. */
export function borderOf(ext, surface, theme) {
    const has = key => ext.settings_schema.has_key(key);
    const width = has(`border-${surface}-width`) ? ext.get_int(`border-${surface}-width`) : 1;
    const kind = has(`border-${surface}-color`) ? ext.get_string(`border-${surface}-color`) : 'outline';
    const pick = COLOR[kind] ?? COLOR.outline;
    const defaults = {qs: 32, appmenu: 32, dock: 28, ctx: 20, settings: 28, datemenu: 36, switcher: 22, osd: 34, prompt: 28, desktop: 14};
    const radius = has(`border-${surface}-radius`) ? ext.get_int(`border-${surface}-radius`) : defaults[surface];
    return {
        width,
        radius,
        light: pick(THEMES[theme].light),
        dark: pick(THEMES[theme].dark),
    };
}

/**
 * A stylesheet layer with the border of the shell surfaces (Quick Settings,
 * app menu, dock, context menus). It goes after the themed stylesheet so it wins.
 */
export function bordersCss(ext, theme) {
    const surfaces = [
        ['qs', ['.m3-qs.quick-settings'], ['.m3-qs.m3-dark.quick-settings']],
        ['appmenu', ['.m3-appmenu'], ['.m3-qs.m3-dark .m3-appmenu']],
        ['dock', ['.m3-dock-bar', '.m3-prev'],
            ['.m3-qs.m3-dark .m3-dock-bar', '.m3-qs.m3-dark .m3-prev']],
        ['ctx', ['.m3-ctx'], ['.m3-qs.m3-dark .m3-ctx']],
        ['datemenu', ['.m3-dm-root'], ['.m3-qs.m3-dark .m3-dm-root']],
        ['switcher', ['.m3-sw-hud'], ['.m3-qs.m3-dark .m3-sw-hud']],
        ['osd', ['.m3-osd'], ['.m3-qs.m3-dark .m3-osd']],
        ['prompt', ['.m3-dc-card'], ['.m3-qs.m3-dark .m3-dc-card']],
        ['desktop', ['.m3-di.m3-di-selected'], ['.m3-qs.m3-dark .m3-di.m3-di-selected']],
    ];
    let css = '\n/* material3: borders */\n';
    for (const [id, light, dark] of surfaces) {
        const b = borderOf(ext, id, theme);
        const rule = color => `${b.width > 0
            ? `border: ${b.width}px solid ${color} !important;`
            : 'border: 0px solid transparent !important;'} border-radius: ${b.radius}px !important;`;
        css += `${light.join(',\n')} { ${rule(b.light)} }\n`;
        css += `${dark.join(',\n')} { ${rule(b.dark)} }\n`;
    }
    return css;
}
