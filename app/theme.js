import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {borderOf} from '../features/quickSettings/borders.js';
import {THEMES, THEME_ORDER, shiftLightness} from '../features/quickSettings/themes.js';
import {extSettings} from './sys.js';

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** `#RRGGBB` -> [r, g, b] in 0..1 (for cairo). */
export const unit = hex => rgb(hex).map(v => v / 255);

/** CSS `rgba()` from a hex color. */
export const alpha = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

/** Linear mix of two hex colors (`t` = weight of `b`). */
export function mix(a, b, t) {
    const [ra, rb] = [rgb(a), rgb(b)];
    return `#${ra.map((v, i) => Math.round(v + (rb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Material 3 palette of the app: GNOME's accent color and light/dark
 * choice, turned into the tokens the stylesheet and the drawn widgets use.
 */
class Palette {
    constructor() {
        this.t = null;
        this.key = 'purple';
        this.dark = false;
        this._listeners = new Set();
        this._provider = null;
        this._iface = null;
    }

    start() {
        const source = Gio.SettingsSchemaSource.get_default();
        if (source?.lookup('org.gnome.desktop.interface', true)) {
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._iface.connect('changed::color-scheme', () => this._update());
            if (this._iface.settings_schema.has_key('accent-color'))
                this._iface.connect('changed::accent-color', () => this._update());
        }
        const ext = extSettings();
        if (ext)
            ext.connect('changed', (_s, key) => key.startsWith('border-settings-') && this._update());
        this._provider = new Gtk.CssProvider();
        // Above the user's gtk.css (which the extension also writes).
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), this._provider,
            Gtk.STYLE_PROVIDER_PRIORITY_USER + 1);
        this._update();
    }

    /** @returns {function(): void} unsubscribe */
    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /** Accent of every palette: [{key, primary, container}] in the current mode. */
    swatches() {
        const mode = this.dark ? 'dark' : 'light';
        return THEME_ORDER.map(key => ({
            key,
            primary: THEMES[key][mode].primary,
            container: THEMES[key][mode].secondaryContainer,
        }));
    }

    _update() {
        let key = 'purple';
        let dark = false;
        if (this._iface) {
            if (this._iface.settings_schema.has_key('accent-color')) {
                const accent = this._iface.get_string('accent-color');
                if (THEME_ORDER.includes(accent))
                    key = accent;
            }
            dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        }
        this.key = key;
        this.dark = dark;

        const base = THEMES[key][dark ? 'dark' : 'light'];
        const t = {...base};
        t.primaryContainer = dark ? shiftLightness(base.primary, -0.5) : shiftLightness(base.primary, 0.42);
        t.onPrimaryContainer = dark ? shiftLightness(base.primary, 0.06) : shiftLightness(base.primary, -0.38);
        t.outline = mix(base.variant, base.surface, 0.3);
        t.hover = mix(base.highest, base.onSurface, 0.06);
        t.isDark = dark;
        const ext = extSettings();
        if (ext?.settings_schema.has_key('border-settings-width')) {
            const b = borderOf(ext, 'settings', key);
            t.windowRadius = b.radius;
            t.windowBorder = b.width > 0 ? `${b.width}px solid ${dark ? b.dark : b.light}` : 'none';
        } else {
            t.windowRadius = 28;
            t.windowBorder = 'none';
        }
        this.t = t;

        const gtk = Gtk.Settings.get_default();
        if (gtk)
            gtk.gtk_application_prefer_dark_theme = dark;
        try {
            this._provider.load_from_string(css(t));
        } catch (e) {
            console.error(`material3: stylesheet failed: ${e.message}`);
        }
        for (const fn of [...this._listeners])
            fn();
    }
}

export const palette = new Palette();

/** The whole stylesheet of the app. */
function css(t) {
    const font = '"Plus Jakarta Sans", "Cantarell", sans-serif';
    return `
window.m3 {
  background-color: ${t.surface};
  color: ${t.onSurface};
  font-family: ${font};
  font-size: 13px;
}
window.m3.csd, window.m3.csd:backdrop { border-radius: ${t.windowRadius}px; border: ${t.windowBorder}; outline: none; box-shadow: none; }
window.m3, window.m3:backdrop { box-shadow: none; outline: none; }
window.m3.csd.maximized, window.m3.csd.fullscreen, window.m3.csd.tiled,
window.m3.csd.tiled-left, window.m3.csd.tiled-right, window.m3.csd.tiled-top,
window.m3.csd.tiled-bottom { border-radius: 0; }

window.m3 label, window.m3 entry, window.m3 button { font-family: ${font}; }

headerbar.m3-head {
  background-color: ${t.container};
  background-image: none;
  color: ${t.onSurface};
  border: none;
  border-bottom: 1px solid ${t.outlineVariant};
  border-radius: ${Math.max(0, t.windowRadius - 1)}px ${Math.max(0, t.windowRadius - 1)}px 0 0;
  box-shadow: none;
  min-height: 38px;
  padding: 0 8px 0 10px;
}
window.m3.maximized headerbar.m3-head, window.m3.fullscreen headerbar.m3-head,
window.m3.tiled headerbar.m3-head, window.m3.tiled-left headerbar.m3-head,
window.m3.tiled-right headerbar.m3-head, window.m3.tiled-top headerbar.m3-head,
window.m3.tiled-bottom headerbar.m3-head { border-radius: 0; }
button.m3-wc {
  min-width: 0; min-height: 0; padding: 0; margin: 0 2px;
  border: none; box-shadow: none; background: none; background-color: transparent; color: ${t.onSurface};
  border-radius: 99px; outline: none;
}
button.m3-wc .m3-wc-dot { border-radius: 99px; background-color: transparent; }
button.m3-wc:hover .m3-wc-dot { background-color: ${t.highest}; }
button.m3-wc:active .m3-wc-dot { background-color: ${t.hover}; }
button.m3-wc.close:hover .m3-wc-dot { background-color: rgba(220,38,38,0.2); color: #f2564f; }
.m3-appicon {
  background-color: ${t.primaryContainer}; color: ${t.onPrimaryContainer};
  border-radius: 99px; min-width: 24px; min-height: 24px;
}
.m3-wintitle { font-size: 14px; font-weight: 700; }

.m3-handle { background-color: transparent; margin: 0 -3px 0 -3px; }
.m3-handle:hover { background-color: ${t.outlineVariant}; }
.m3-split > separator { min-width: 7px; background: transparent; background-color: transparent; border: none; margin: 0 -3px 0 -4px; }
.m3-split > separator:hover { background-color: ${t.outlineVariant}; }
.m3-sidebar { background-color: ${t.container}; border-right: 1px solid ${t.outlineVariant}; }
button.m3-nav.compact { margin: 1px 8px; }
button.m3-nav.compact .m3-navline { padding: 9px 0; }
window.m3.csd .m3-sidebar { border-radius: 0 0 0 ${Math.max(0, t.windowRadius - 1)}px; }
window.m3.maximized .m3-sidebar, window.m3.fullscreen .m3-sidebar, window.m3.tiled .m3-sidebar,
window.m3.tiled-left .m3-sidebar, window.m3.tiled-right .m3-sidebar { border-radius: 0; }
.m3-search-wrap { margin: 12px 12px 6px 12px; }
entry.m3-search {
  background-color: ${t.highest}; background-image: none; color: ${t.onSurface};
  border: 2px solid transparent; border-radius: 99px; box-shadow: none;
  min-height: 38px; padding: 0 14px 0 38px; caret-color: ${t.primary};
}
entry.m3-search:focus-within { border-color: ${t.primary}; }
entry.m3-search text { color: ${t.onSurface}; }
.m3-search-icon { color: ${t.variant}; margin-left: 12px; }
.m3-group { font-size: 11px; font-weight: 700; color: ${t.variant}; margin: 12px 24px 4px 24px; letter-spacing: 0.5px; }
button.m3-nav {
  background-color: transparent; background-image: none; color: ${t.onSurface};
  border: none; box-shadow: none; border-radius: 99px; padding: 0; margin: 1px 12px;
  min-height: 0; font-weight: 500;
}
.m3-navline { padding: 9px 14px; }
.m3-sidebar.style-cards .m3-navline { padding: 10px 14px; }
button.m3-nav:hover { background-color: ${t.hover}; }
button.m3-nav.active { background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer}; font-weight: 700; }
.m3-navbadge { border-radius: 99px; min-width: 40px; min-height: 40px; }
.m3-navtitle { font-size: 14px; font-weight: 600; }
.m3-navsub { font-size: 12px; color: ${t.variant}; font-weight: 400; }
button.m3-nav.active .m3-navsub { color: ${t.onSecondaryContainer}; }
.m3-sidebar.style-pills .m3-navsub { font-size: 0; min-height: 0; margin: 0; padding: 0; opacity: 0; }
.m3-sidebar.style-pills .m3-navbadge { background-color: transparent; min-width: 22px; min-height: 22px; }
.m3-sidebar.style-pills .m3-navbadge label { color: inherit; }
.m3-sidebar.style-cards { background-color: ${t.surface}; }
.m3-sidebar.style-cards .m3-navgroup { margin: 0 12px 14px 12px; }
.m3-sidebar.style-cards button.m3-nav {
  background-color: ${t.container}; border-radius: 6px; margin: 0 0 2px 0;
}
.m3-sidebar.style-cards button.m3-nav:first-child { border-top-left-radius: 24px; border-top-right-radius: 24px; }
.m3-sidebar.style-cards button.m3-nav:last-child { border-bottom-left-radius: 24px; border-bottom-right-radius: 24px; margin-bottom: 0; }
.m3-sidebar.style-cards button.m3-nav:only-child { border-radius: 24px; }
.m3-sidebar.style-cards button.m3-nav:hover { background-color: ${t.hover}; }
.m3-sidebar.style-cards button.m3-nav.active { background-color: ${t.secondaryContainer}; }
.m3-sidebar.style-cards button.m3-nav.compact { margin: 0 0 2px 0; }
.m3-sidebar.style-cards button.m3-nav.compact .m3-navline { padding: 8px 0; }
.m3-sidebar.style-cards .tone-sky { background-color: ${t.isDark ? '#1F4E63' : '#B3E5FC'}; color: ${t.isDark ? '#A8DDF5' : '#01579B'}; }
.m3-sidebar.style-cards .tone-amber { background-color: ${t.isDark ? '#5C4A12' : '#FFE082'}; color: ${t.isDark ? '#FFE082' : '#5D4300'}; }
.m3-sidebar.style-cards .tone-green { background-color: ${t.isDark ? '#254A2C' : '#C8E6C9'}; color: ${t.isDark ? '#B6E5BA' : '#1B5E20'}; }
.m3-sidebar.style-cards .tone-gray { background-color: ${t.isDark ? '#3C4043' : '#E0E0E0'}; color: ${t.isDark ? '#D0D3D6' : '#424242'}; }
.m3-sidebar.style-cards .tone-pink { background-color: ${t.isDark ? '#5E2A3F' : '#F8BBD0'}; color: ${t.isDark ? '#FBC8DB' : '#880E4F'}; }
.m3-sidebar.style-cards .tone-violet { background-color: ${t.isDark ? '#43366B' : '#D1C4E9'}; color: ${t.isDark ? '#D7CBF5' : '#311B92'}; }
button.m3-nav:focus-visible { outline: 2px solid ${t.primary}; outline-offset: -2px; }

.m3-content { background-color: ${t.surface}; }
window.m3.csd .m3-content { border-radius: 0 0 ${Math.max(0, t.windowRadius - 1)}px 0; }
.m3-page { padding: 20px; }
.m3-title { font-size: 20px; font-weight: 700; }
.m3-subtitle { font-size: 12px; color: ${t.variant}; }
.m3-section { font-size: 12px; font-weight: 700; color: ${t.primary}; margin: 6px 6px 0 6px; }
.m3-row-title { font-size: 13px; font-weight: 700; }
.m3-row-sub { font-size: 12px; color: ${t.variant}; }
.m3-dim { color: ${t.variant}; }
.m3-mono { font-family: "Roboto Mono", monospace; }

.m3-card { background-color: ${t.container}; border-radius: 24px; padding: 16px; }
.m3-card.list { background-color: transparent; padding: 0; border-radius: 0; }
.m3-card.list > .m3-row { background-color: ${t.container}; border-radius: 6px; padding: 16px; }
.m3-card.list > .m3-row:first-child { border-radius: 24px 24px 6px 6px; }
.m3-card.list > .m3-row:last-child { border-radius: 6px 6px 24px 24px; }
.m3-card.list > .m3-row:only-child { border-radius: 24px; }
.m3-row { padding: 14px 16px; }
.m3-row.clickable:hover { background-color: ${t.hover}; }
separator.m3-sep { background-color: ${alpha(t.outlineVariant, 0.7)}; min-height: 1px; margin: 0 16px; }
.m3-hero { background-color: ${t.primaryContainer}; color: ${t.onPrimaryContainer}; border-radius: 24px; padding: 16px; }
.m3-hero .m3-row-sub { color: ${t.onPrimaryContainer}; opacity: 0.85; }
.m3-tile {
  background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer};
  border-radius: 99px; min-width: 40px; min-height: 40px;
}
.m3-badge {
  background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer};
  border-radius: 99px; padding: 2px 10px; font-size: 11px; font-weight: 700;
}
.m3-badge.primary { background-color: ${t.primary}; color: ${t.onPrimary}; }

/* One family only: fontconfig substitutes a text font for a missing family, which breaks the ligatures. */
.ms, window.m3 label.ms, window.m3-dialog label.ms, window.m3 button label.ms {
  font-family: "Material Symbols Rounded Filled"; font-size: 20px; font-weight: 400; font-style: normal;
}
window.m3 label.ms-14, window.m3-dialog label.ms-14 { font-size: 14px; }
window.m3 label.ms-16, window.m3-dialog label.ms-16 { font-size: 16px; }
window.m3 label.ms-18, window.m3-dialog label.ms-18 { font-size: 18px; }
window.m3 label.ms-22, window.m3-dialog label.ms-22 { font-size: 22px; }
window.m3 label.ms-26, window.m3-dialog label.ms-26 { font-size: 26px; }
window.m3 label.ms-30, window.m3-dialog label.ms-30 { font-size: 30px; }

button.m3-btn {
  background-color: ${t.highest}; background-image: none; color: ${t.onSurface};
  border: none; box-shadow: none; border-radius: 99px; padding: 7px 16px; min-height: 0;
  font-weight: 700; font-size: 12px;
}
button.m3-btn:hover { background-color: ${t.hover}; }
button.m3-btn.filled { background-color: ${t.primary}; color: ${t.onPrimary}; }
button.m3-btn.filled:hover { background-color: ${mix(t.primary, t.onPrimary, 0.12)}; }
button.m3-btn.tonal { background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer}; }
button.m3-btn.danger { background-color: rgba(220,38,38,0.14); color: #dc2626; }
button.m3-btn:disabled { opacity: 0.45; }
button.m3-icon {
  background-color: ${t.highest}; background-image: none; color: ${t.onSurface};
  border: none; box-shadow: none; border-radius: 12px; min-width: 34px; min-height: 34px; padding: 0;
}
headerbar.m3-head button.m3-icon { min-width: 28px; min-height: 28px; border-radius: 10px; }
button.m3-icon:hover { background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer}; }
button.m3-chip {
  background-color: transparent; background-image: none; color: ${t.onSurface};
  border: 1px solid ${t.outline}; box-shadow: none; border-radius: 99px; padding: 6px 16px;
  min-height: 0; font-weight: 600; font-size: 12px;
}
button.m3-chip.active { background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer}; border-color: transparent; }
button.m3-chip:hover { background-color: ${t.hover}; }
button.m3-chip.active:hover { background-color: ${t.secondaryContainer}; }

.m3-switch { min-width: 54px; min-height: 32px; border-radius: 99px; }
.m3-switch:disabled { opacity: 0.5; }
.m3-switch:focus-visible { outline: 2px solid ${t.primary}; outline-offset: 2px; }

menubutton.m3-dd > button {
  background-color: ${t.highest}; background-image: none; color: ${t.onSurface};
  border: none; box-shadow: none; border-radius: 99px; padding: 0 14px; min-height: 32px; min-width: 0;
  font-weight: 500; font-size: 14px;
}
menubutton.m3-dd > button:hover, menubutton.m3-dd.open > button { background-color: ${t.secondaryContainer}; color: ${t.onSecondaryContainer}; }
.m3-dd-value { font-variant-numeric: tabular-nums; }
popover.m3-dd > contents {
  background-color: alpha(${t.highest}, 0.92); color: ${t.onSurface}; border-radius: 20px;
  border: 1px solid alpha(${t.onSurface}, 0.12); padding: 6px; box-shadow: 0 14px 32px rgba(0,0,0,0.4);
}
popover.m3-dd scrolledwindow, popover.m3-dd .m3-dd-list { background: transparent; margin: 0; padding: 0; }
button.m3-dd-item {
  background: none; background-image: none; border: none; box-shadow: none; color: ${t.onSurface};
  border-radius: 13px; padding: 9px 14px; min-height: 0; font-size: 14px; font-weight: 500;
}
button.m3-dd-item:hover { background-color: alpha(${t.onSurface}, 0.08); }
button.m3-dd-item.active { background-color: ${t.primaryContainer}; color: ${t.onPrimaryContainer}; font-weight: 700; }
popover.m3-dd searchentry, popover.m3-dd entry { background-color: ${t.container}; border-radius: 99px; color: ${t.onSurface}; min-height: 32px; }

entry.m3-entry, spinbutton.m3-entry, passwordentry.m3-entry text {
  background-color: ${t.highest}; background-image: none; color: ${t.onSurface};
  border: 2px solid transparent; border-radius: 16px; box-shadow: none; min-height: 34px; padding: 0 12px;
  caret-color: ${t.primary};
}
entry.m3-entry:focus-within { border-color: ${t.primary}; }

button.m3-swatch {
  background-color: ${t.highest}; background-image: none; border: 2px solid transparent;
  box-shadow: none; border-radius: 22px; padding: 10px 6px 8px 6px; min-height: 0; color: ${t.onSurface};
}
button.m3-swatch:hover { background-color: ${t.hover}; }
button.m3-swatch.active { border-color: ${t.primary}; background-color: ${alpha(t.primary, 0.14)}; }
.m3-swatch-text { font-size: 11px; font-weight: 700; }
button.m3-wall {
  background-color: ${t.highest}; background-image: none; border: 3px solid transparent;
  box-shadow: none; border-radius: 18px; padding: 0; min-height: 0;
}
button.m3-wall:hover { border-color: ${alpha(t.primary, 0.5)}; }
button.m3-wall.active { border-color: ${t.primary}; }
picture.m3-thumb { border-radius: 14px; }

.m3-bar trough { background-color: ${t.highest}; border-radius: 99px; min-height: 14px; border: none; }
.m3-bar progress { background-color: ${t.primary}; border-radius: 99px; min-height: 14px; border: none; }
.m3-seg { border-radius: 99px; min-height: 10px; margin-right: 2px; }
.m3-seg.a { background-color: ${t.primary}; }
.m3-seg.b { background-color: ${mix(t.primary, t.onSurface, 0.35)}; }
.m3-seg.c { background-color: ${mix(t.primary, t.surface, 0.45)}; }
.m3-seg.d { background-color: ${t.outline}; }
.m3-dot { border-radius: 99px; min-width: 10px; min-height: 10px; }
.m3-dot.a { background-color: ${t.primary}; }
.m3-dot.b { background-color: ${mix(t.primary, t.onSurface, 0.35)}; }
.m3-dot.c { background-color: ${mix(t.primary, t.surface, 0.45)}; }
.m3-dot.d { background-color: ${t.outline}; }

levelbar.m3-level trough { background-color: ${t.highest}; border-radius: 99px; min-height: 8px; border: none; }
levelbar.m3-level block.filled { background-color: ${t.primary}; border-radius: 99px; }

.m3-toast {
  background-color: ${t.onSurface}; color: ${t.surface}; border-radius: 99px;
  padding: 10px 18px; font-weight: 600; font-size: 12px; margin-bottom: 24px;
}

scrollbar { background: transparent; }
scrollbar slider { background-color: ${t.outlineVariant}; border-radius: 99px; min-width: 6px; min-height: 6px; }
scrollbar slider:hover { background-color: ${t.outline}; }

window.m3-dialog, window.m3-dialog:backdrop {
  background-color: ${t.highest}; color: ${t.onSurface}; font-family: ${font}; border-radius: 28px;
  border: none; box-shadow: none; outline: none; min-width: 280px;
}
.m3-dialog-title { font-size: 24px; font-weight: 500; line-height: 1.3; }
window.m3-dialog .m3-row-sub { font-size: 14px; }
button.m3-textbtn {
  background: none; background-color: transparent; box-shadow: none; border: none; border-radius: 99px;
  color: ${t.primary}; padding: 8px 14px; min-height: 0; min-width: 0; font-size: 14px; font-weight: 600;
}
button.m3-textbtn:hover { background-color: ${alpha(t.primary, 0.10)}; }
button.m3-textbtn:active { background-color: ${alpha(t.primary, 0.16)}; }
button.m3-textbtn.danger { color: #BA1A1A; }
button.m3-textbtn.danger:hover { background-color: ${alpha('#BA1A1A', 0.10)}; }
tooltip.background { background-color: ${t.onSurface}; color: ${t.surface}; border-radius: 10px; }
tooltip.background label { color: ${t.surface}; }
.m3-kbd { background-color: ${t.highest}; border-radius: 10px; padding: 4px 10px; font-family: "Roboto Mono", monospace; font-size: 11px; font-weight: 600; }
`;
}
