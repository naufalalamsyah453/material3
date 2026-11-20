import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {THEMES, shiftLightness} from './themes.js';

const CACHE_DIR = 'material3';
const GTK_FILE = 'material3-colors.css';
const BEGIN = '/* material3-extension:begin (managed, do not edit) */';
const END = '/* material3-extension:end */';
const IMPORT = `${BEGIN}\n@import url("${GTK_FILE}");\n${END}\n`;

/** Shell chrome that follows the palette (dark mode only: the shell is dark). */
function shellCss(t) {
    return `
#panel {
  background-color: ${t.container};
}

.popup-menu-content,
.popup-sub-menu {
  background-color: ${t.container};
}

.popup-menu-item:hover,
.popup-menu-item:focus,
.popup-menu-item:active,
.popup-menu-item.selected {
  background-color: ${t.highest};
}

.message,
.notification-banner,
.calendar {
  background-color: ${t.highest};
}

.switcher-list,
.osd-window {
  background-color: ${t.container};
}
`;
}

/** libadwaita (GTK 4) and GTK 3 named colors for one palette and mode. */
function gtkCss(t, dark) {
    const accentText = dark ? shiftLightness(t.primary, 0.22) : shiftLightness(t.primary, -0.08);

    // Dark: windows use the Quick Settings panel color, lists the deeper
    // surface. Light: windows use the surface, bars the container.
    const window = dark ? t.container : t.surface;
    const view = t.surface;
    const bar = t.container;
    const raised = t.highest;

    const colors = {
        accent_color: accentText,
        accent_bg_color: t.primary,
        accent_fg_color: t.onPrimary,
        destructive_color: dark ? '#FF7B63' : '#C01C28',
        window_bg_color: window,
        window_fg_color: t.onSurface,
        view_bg_color: view,
        view_fg_color: t.onSurface,
        headerbar_bg_color: bar,
        headerbar_fg_color: t.onSurface,
        headerbar_border_color: bar,
        headerbar_backdrop_color: window,
        headerbar_shade_color: 'rgba(0, 0, 0, 0.12)',
        sidebar_bg_color: dark ? raised : bar,
        sidebar_fg_color: t.onSurface,
        sidebar_backdrop_color: window,
        sidebar_shade_color: 'rgba(0, 0, 0, 0.12)',
        secondary_sidebar_bg_color: bar,
        secondary_sidebar_fg_color: t.onSurface,
        secondary_sidebar_backdrop_color: window,
        card_bg_color: dark ? raised : t.container,
        card_fg_color: t.onSurface,
        card_shade_color: 'rgba(0, 0, 0, 0.1)',
        dialog_bg_color: window,
        dialog_fg_color: t.onSurface,
        popover_bg_color: raised,
        popover_fg_color: t.onSurface,
        thumbnail_bg_color: raised,
        thumbnail_fg_color: t.onSurface,
    };

    // GTK 3 themes read the older theme_* names.
    const gtk3 = {
        theme_bg_color: window,
        theme_fg_color: t.onSurface,
        theme_base_color: view,
        theme_text_color: t.onSurface,
        theme_selected_bg_color: t.primary,
        theme_selected_fg_color: t.onPrimary,
        theme_unfocused_bg_color: window,
        theme_unfocused_fg_color: t.onSurface,
        theme_unfocused_base_color: view,
        theme_unfocused_text_color: t.onSurface,
        theme_unfocused_selected_bg_color: t.primary,
        theme_unfocused_selected_fg_color: t.onPrimary,
        borders: t.outlineVariant,
        unfocused_borders: t.outlineVariant,
    };

    return Object.entries({...colors, ...gtk3})
        .map(([name, value]) => `@define-color ${name} ${value};`)
        .join('\n') + '\n';
}

/** @returns {boolean} true when the file was (re)written */
function writeIfChanged(path, text) {
    const file = Gio.File.new_for_path(path);
    try {
        const [, bytes] = file.load_contents(null);
        if (new TextDecoder().decode(bytes) === text)
            return false;
    } catch {
        // Not there yet.
    }
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.NONE, null);
    return true;
}

/**
 * Titlebars of X11/Xwayland apps (Qt, Electron, Java...) are drawn by
 * `mutter-x11-frames`, a GTK 4 + libadwaita client that reads gtk-4.0 CSS only
 * once at start. Mutter relaunches it and re-frames the windows, so ending it
 * makes it pick up new colors.
 */
function restartFrames() {
    try {
        Gio.Subprocess.new(['pkill', '-x', 'mutter-x11-frames'], Gio.SubprocessFlags.NONE);
    } catch {
        // No pkill, or no frames client running.
    }
}

/** Make `gtk.css` import our colors file, once. Returns false when it must not be touched. */
function ensureImport(dir) {
    const path = GLib.build_filenamev([dir, 'gtk.css']);
    const file = Gio.File.new_for_path(path);

    let existing = '';
    try {
        const info = file.query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        // A symlinked gtk.css belongs to a dotfile manager or a theming tool.
        if (info.get_is_symlink())
            return false;
        existing = new TextDecoder().decode(file.load_contents(null)[1]);
    } catch {
        // No gtk.css yet.
    }

    if (existing.includes(BEGIN))
        return true;
    writeIfChanged(path, IMPORT + existing);
    return true;
}

/** Remove our import block from `gtk.css` and delete the colors file. Returns true if a colors file was deleted. */
function removeImport(dir) {
    const path = GLib.build_filenamev([dir, 'gtk.css']);
    try {
        const file = Gio.File.new_for_path(path);
        const info = file.query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (!info.get_is_symlink()) {
            const text = new TextDecoder().decode(file.load_contents(null)[1]);
            const start = text.indexOf(BEGIN);
            const end = text.indexOf(END);
            if (start !== -1 && end !== -1) {
                const rest = text.slice(0, start) + text.slice(end + END.length).replace(/^\n/, '');
                if (rest.trim() === '')
                    file.delete(null);
                else
                    writeIfChanged(path, rest);
            }
        }
    } catch {
        // No gtk.css, or nothing of ours in it.
    }

    try {
        Gio.File.new_for_path(GLib.build_filenamev([dir, GTK_FILE])).delete(null);
        return true;
    } catch {
        // Already gone.
        return false;
    }
}

/**
 * Carries the palette past the extension's own widgets: to the shell's chrome
 * (a stylesheet) and to GTK apps (a colors file next to the user's gtk.css).
 */
export class ShellTheme {
    /**
     * @param {Gio.Settings} settings extension settings
     */
    constructor(settings) {
        this._settings = settings;
        this._file = null;
        this._loadedIn = null;
        this._framesId = 0;
    }

    /**
     * @param {string} key palette name
     * @param {boolean} dark
     */
    apply(key, dark) {
        const tokens = THEMES[key]?.[dark ? 'dark' : 'light'];
        if (!tokens)
            return;
        this._applyShell(key, dark, tokens);
        this._applyApps(dark, tokens);
    }

    _unloadShell() {
        if (this._file && this._loadedIn) {
            try {
                this._loadedIn.unload_stylesheet(this._file);
            } catch {
                // The shell already dropped it with its old theme.
            }
        }
        this._file = null;
        this._loadedIn = null;
    }

    _applyShell(key, dark, tokens) {
        this._unloadShell();
        if (!dark || !this._settings.get_boolean('theme-shell'))
            return;

        try {
            const css = shellCss(tokens);
            const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_DIR]);
            GLib.mkdir_with_parents(dir, 0o755);
            const file = Gio.File.new_for_path(GLib.build_filenamev([
                dir, `shell-${key}-${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, css, -1).slice(0, 8)}.css`]));
            file.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.NONE, null);

            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.load_stylesheet(file);
            this._file = file;
            this._loadedIn = theme;
        } catch (e) {
            console.error(`material3: failed to color the shell: ${e.message}`);
        }
    }

    _applyApps(dark, tokens) {
        const base = GLib.get_user_config_dir();
        let framesStale = false;
        for (const folder of ['gtk-4.0', 'gtk-3.0']) {
            const dir = GLib.build_filenamev([base, folder]);
            try {
                if (!this._settings.get_boolean('theme-apps')) {
                    if (removeImport(dir) && folder === 'gtk-4.0')
                        framesStale = true;
                    continue;
                }
                if (!ensureImport(dir)) {
                    console.warn(`material3: ${folder}/gtk.css is a symlink; GTK apps are not colored there`);
                    continue;
                }
                if (writeIfChanged(GLib.build_filenamev([dir, GTK_FILE]), gtkCss(tokens, dark)) &&
                    folder === 'gtk-4.0')
                    framesStale = true;
            } catch (e) {
                console.error(`material3: failed to color ${folder} apps: ${e.message}`);
            }
        }
        if (framesStale)
            this._queueFramesRestart();
    }

    _queueFramesRestart() {
        // Several writes can land together (accent + scheme change).
        if (this._framesId)
            GLib.source_remove(this._framesId);
        this._framesId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._framesId = 0;
            restartFrames();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * @param {boolean} [removeApps] also take the colors away from GTK apps
     */
    destroy(removeApps = false) {
        this._unloadShell();
        if (this._framesId) {
            GLib.source_remove(this._framesId);
            this._framesId = 0;
        }
        if (!removeApps)
            return;
        const base = GLib.get_user_config_dir();
        let framesStale = false;
        for (const folder of ['gtk-4.0', 'gtk-3.0']) {
            try {
                if (removeImport(GLib.build_filenamev([base, folder])) && folder === 'gtk-4.0')
                    framesStale = true;
            } catch (e) {
                console.error(`material3: failed to restore ${folder}: ${e.message}`);
            }
        }
        if (framesStale)
            restartFrames();
    }
}
