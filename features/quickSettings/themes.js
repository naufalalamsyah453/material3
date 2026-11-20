/*
 * Material You palettes from the reference HTML (lavender, sage, ocean,
 * terracotta; light and dark). stylesheet.css is written in lavender; other
 * themes are produced by swapping its colors token by token, so the
 * stylesheet stays the single source of truth for the component styles.
 */

/*
 * Palettes follow the GNOME accent color (org.gnome.desktop.interface
 * accent-color). Purple is the base (lavender) palette; every other accent is
 * the palette built from that accent (see fromAccent).
 */
export const THEME_ORDER = ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'slate'];

export const THEME_NAMES = {
    purple: 'Purple',
    blue: 'Blue',
    teal: 'Teal',
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
    red: 'Red',
    pink: 'Pink',
    slate: 'Slate',
};

/**
 * GNOME accent colors, exactly as libadwaita defines them
 * (https://github.com/GNOME/libadwaita/blob/main/src/adw-accent-color.c).
 */
const ACCENTS = {
    purple: '#9141ac',
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    slate: '#6f8396',
};

/** Legacy `theme` values of the extension's own setting. */
export const LEGACY_THEME_ACCENTS = {
    lavender: 'purple',
    sage: 'green',
    ocean: 'blue',
    terracotta: 'orange',
};

const tokens = (primary, onPrimary, secondaryContainer, onSecondaryContainer,
    surface, container, highest, onSurface, variant, outlineVariant) => ({
    primary,
    onPrimary,
    secondaryContainer,
    onSecondaryContainer,
    surface,
    container,
    highest,
    onSurface,
    variant,
    outlineVariant,
});

export const THEMES = {
    lavender: {
        light: tokens('#6750A4', '#FFFFFF', '#E8DEF8', '#1D192B', '#FEF7FF',
            '#F3EDF7', '#E6E0E9', '#1D1B20', '#49454F', '#CAC4D0'),
        dark: tokens('#D0BCFF', '#381E72', '#4A4458', '#E8DEF8', '#141218',
            '#211F26', '#36343B', '#E6E0E9', '#CAC4D0', '#49454F'),
    },
    sage: {
        light: tokens('#2E6A44', '#FFFFFF', '#D1E8D4', '#0C1F13', '#F6FBF4',
            '#EAECE8', '#DEE4DC', '#181D19', '#414942', '#C1C9BF'),
        dark: tokens('#95D5A6', '#00391B', '#374B3C', '#D1E8D4', '#101511',
            '#1C211D', '#313631', '#E0E4DE', '#C1C9BF', '#414942'),
    },
    ocean: {
        light: tokens('#1A6585', '#FFFFFF', '#D0E6F3', '#091E27', '#F6FAFE',
            '#EAEEF2', '#DFE3E7', '#171C1F', '#40484D', '#C0C7CD'),
        dark: tokens('#8ECFF3', '#003549', '#364954', '#D0E6F3', '#0F1417',
            '#1B2023', '#303539', '#DFE3E7', '#C0C7CD', '#40484D'),
    },
    terracotta: {
        light: tokens('#8F4C38', '#FFFFFF', '#FFDBD1', '#2C150F', '#FFF8F6',
            '#F6EBE8', '#EBE0DD', '#231917', '#53433F', '#D8C2BC'),
        dark: tokens('#FFB5A0', '#561F0F', '#5D4037', '#FFDBD1', '#1A110F',
            '#271D1B', '#3D322F', '#F1DFDA', '#D8C2BC', '#53433F'),
    },
};

function hslOf(hex) {
    const [r, g, b] = rgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0)
        return [0, 0, l];
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return [(h * 60 + 360) % 360, sat, l];
}

function hexOf(h, sat, l) {
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
    return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Palette for one GNOME accent. The primary color is the accent itself
 * (white text on it, as libadwaita does); every other token keeps the
 * lightness of the base palette but takes the accent's hue, so the surfaces
 * are tinted with (dark) accent shades.
 */
function fromAccent(set, accentHex) {
    const [hue, accentSat] = hslOf(accentHex);
    const [, baseSat] = hslOf(THEMES.lavender.light.primary);
    const satScale = Math.min(2, accentSat / baseSat);
    const out = {};
    for (const [name, hex] of Object.entries(set)) {
        const [, s, l] = hslOf(hex);
        if (name === 'primary')
            out[name] = accentHex.toUpperCase();
        else if (name === 'onPrimary')
            out[name] = '#FFFFFF';
        else
            out[name] = s === 0 ? hex : hexOf(hue, Math.min(1, s * satScale), l);
    }
    return out;
}

for (const [name, hex] of Object.entries(ACCENTS)) {
    THEMES[name] = {
        light: fromAccent(THEMES.lavender.light, hex),
        dark: fromAccent(THEMES.lavender.dark, hex),
    };
}

/**
 * @param {string} hex #RRGGBB
 * @param {number} delta added to the HSL lightness (-1..1)
 * @returns {string} #RRGGBB
 */
export function shiftLightness(hex, delta) {
    const [h, s, l] = hslOf(hex);
    return hexOf(h, s, Math.max(0, Math.min(1, l + delta)));
}

/**
 * @param {string} hex #RRGGBB
 * @returns {Array<number>} [r, g, b]
 */
function rgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * Tile text colors (inactive -> active) for the JS-driven color tween.
 *
 * @param {string} theme
 * @param {boolean} dark
 * @returns {object}
 */
export function tileText(theme, dark) {
    const t = THEMES[theme][dark ? 'dark' : 'light'];
    const subAlpha = dark ? 0.8 : 0.85;
    return {
        icon: [...rgb(t.onSurface), 1],
        title: [...rgb(t.onSurface), 1],
        subtitle: [...rgb(t.variant), 1],
        onIcon: [...rgb(t.onPrimary), 1],
        onTitle: [...rgb(t.onPrimary), 1],
        onSubtitle: [...rgb(t.onPrimary), subAlpha],
    };
}

/**
 * Apply the UI scale and font to one rule body: every px length is scaled
 * (text sizes also by the font factor) and the text font family replaced.
 * The monospace badge font and the icon fonts are left alone.
 *
 * @param {string} body
 * @param {{scale: number, fontScale: number, font: string}} tune
 * @returns {string}
 */
function tuned(body, {scale, fontScale, font}) {
    let out = body;
    if (scale !== 1 || fontScale !== 1) {
        out = out.replace(/(font-size:\s*)(\d+(?:\.\d+)?)px/g, (_m, head, n) =>
            `${head}${(Math.round(n * scale * fontScale * 10) / 10)}px`);
        out = out.replace(/(^|[^\w-])(\d+(?:\.\d+)?)px/g, (m, pre, n, offset, whole) => {
            // font-size was already handled above (its value now ends in px
            // and is preceded by a space); skip it here.
            if (/font-size:\s*$/.test(whole.slice(0, offset + pre.length)))
                return m;
            const value = Number(n);
            const scaled = value === 0 ? 0 : Math.max(1, Math.round(value * scale));
            return `${pre}${scaled}px`;
        });
    }
    if (font)
        out = out.replace(/"Plus Jakarta Sans"/g, `"${font}"`);
    return out;
}

/**
 * Re-color the lavender stylesheet for another theme. Rules whose selector
 * contains `m3-dark` use the dark tokens, all others the light tokens.
 *
 * @param {string} css contents of stylesheet.css
 * @param {string} theme
 * @param {{scale: number, fontScale: number, font: string}} [tune] size scale,
 *   text size factor and font family applied on top of the palette
 * @returns {string}
 */
export function themedCss(css, theme, tune = {scale: 1, fontScale: 1, font: ''}) {
    const base = THEMES.lavender;
    const target = THEMES[theme];

    const maps = {};
    for (const mode of ['light', 'dark']) {
        const map = new Map();
        for (const token of Object.keys(base[mode])) {
            const from = base[mode][token];
            const to = target[mode][token];
            map.set(from.toLowerCase(), to);
            map.set(`rgb:${rgb(from).join(',')}`, rgb(to).join(', '));
        }
        maps[mode] = map;
    }

    const colorPattern = /#[0-9a-fA-F]{6}\b|(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?=[,)])/g;

    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/([^{}]+)\{([^{}]*)\}/g, (_match, rawSelector, body) => {
            let selector = rawSelector;
            const map = maps[selector.includes('m3-dark') ? 'dark' : 'light'];
            // One class more than the base rules, so the recolor wins whatever
            // order the shell loads the stylesheets in.
            selector = selector.split(',').map(part => {
                const sel = part.trim();
                return sel.startsWith('.m3-qs') ? `.m3-qs${sel}` : `.m3-qs ${sel}`;
            }).join(',\n');
            const recolored = body.replace(colorPattern, (m, fn, r, g, b) => {
                if (m[0] === '#')
                    return map.get(m.toLowerCase()) ?? m;
                const to = map.get(`rgb:${r},${g},${b}`);
                return to ? `${fn}(${to}` : m;
            });
            // The dock and the app menu carry their own extra scale.
            let factor = 1;
            if (/\.m3-dock|\.m3-tint/.test(selector))
                factor = tune.dock ?? 1;
            else if (/\.m3-appmenu|\.m3-app-|\.m3-ctx/.test(selector))
                factor = tune.menu ?? 1;
            // The right-click menus may have a font of their own.
            const font = /\.m3-ctx/.test(selector) && tune.ctxFont ? tune.ctxFont : tune.font;
            return `${selector}{${tuned(recolored, {...tune, font, scale: tune.scale * factor})}}`;
        });
}

/**
 * Active palette key: the GNOME accent color, or the extension's own setting
 * on a system without one.
 *
 * @param {Gio.Settings} interfaceSettings org.gnome.desktop.interface
 * @param {Gio.Settings} extSettings the extension's settings
 * @returns {string}
 */
export function themeKeyFor(interfaceSettings, extSettings) {
    if (interfaceSettings.settings_schema.has_key('accent-color')) {
        const accent = interfaceSettings.get_string('accent-color');
        if (THEME_ORDER.includes(accent))
            return accent;
    }
    const own = extSettings.get_string('theme');
    return LEGACY_THEME_ACCENTS[own] ?? 'purple';
}

/**
 * Select the next palette (accent color, or the extension's own setting).
 *
 * @param {Gio.Settings} interfaceSettings org.gnome.desktop.interface
 * @param {Gio.Settings} extSettings the extension's settings
 * @returns {string} the new palette key
 */
export function cycleThemeKey(interfaceSettings, extSettings) {
    const current = themeKeyFor(interfaceSettings, extSettings);
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    if (interfaceSettings.settings_schema.has_key('accent-color')) {
        interfaceSettings.set_string('accent-color', next);
    } else {
        extSettings.set_string('theme', Object.keys(LEGACY_THEME_ACCENTS)
            .find(k => LEGACY_THEME_ACCENTS[k] === next) ?? 'lavender');
    }
    return next;
}
