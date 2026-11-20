import Shell from 'gi://Shell';

import {BUILTIN} from './categories.js';

/** Built-in category pills. The app menu reads the user's full list from settings. */
export const CATEGORIES = BUILTIN;

const SYSTEM = new Set([
    'System', 'Settings', 'DesktopSettings', 'HardwareSettings', 'Monitor',
    'PackageManager', 'Security', 'X-GNOME-Settings-Panel',
]);
const UTILITY = new Set([
    'Utility', 'Accessibility', 'Calculator', 'Archiving', 'Compression',
    'Clock', 'TextEditor', 'FileTools', 'Core',
]);

/**
 * Map a desktop entry's freedesktop categories onto the three HTML groups.
 *
 * @param {Gio.AppInfo} info
 * @returns {string} produktivitas | sistem | utilitas
 */
function categoryOfInfo(info) {
    const cats = (info.get_categories?.() ?? '').split(';').filter(Boolean);
    if (cats.some(c => SYSTEM.has(c)))
        return 'sistem';
    if (cats.some(c => UTILITY.has(c)))
        return 'utilitas';
    return 'produktivitas';
}

/**
 * @param {Shell.App} app
 * @returns {string} produktivitas | sistem | utilitas
 */
export function categoryOf(app) {
    const info = app.get_app_info?.();
    return info ? categoryOfInfo(info) : 'produktivitas';
}

/** Stable small number per app id, so a tile keeps its tint in every view. */
function hashOf(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++)
        h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
}

/**
 * Launchable applications, sorted by name, with the text the search matches
 * against. With `only` set, just that category is read: apps outside it are
 * skipped before their app object, name and search text are built, which is
 * what keeps the first open of the menu light.
 *
 * @param {Array<{id: string, apps: string[]}>} custom user-defined categories
 * @param {string|null} only category id to load, or null/'all' for everything
 * @returns {Array<{app: Shell.App, cat: string, cats: Set<string>, text: string, index: number}>}
 */
export function installedApps(custom = [], only = null) {
    const system = Shell.AppSystem.get_default();
    const entries = [];
    const filter = only && only !== 'all' ? only : null;

    // Desktop id -> ids of the custom categories that list it.
    const membership = new Map();
    for (const {id, apps} of custom) {
        for (const appId of apps) {
            if (!membership.has(appId))
                membership.set(appId, []);
            membership.get(appId).push(id);
        }
    }

    for (const info of system.get_installed()) {
        if (!info.should_show())
            continue;
        const appId = info.get_id();
        const cat = categoryOfInfo(info);
        const cats = new Set([cat, ...(membership.get(appId) ?? [])]);
        if (filter && !cats.has(filter))
            continue;

        const app = system.lookup_app(appId);
        if (!app)
            continue;
        const text = [
            app.get_name(),
            info.get_generic_name?.() ?? '',
            app.get_description() ?? '',
            cat,
        ].join(' ').toLowerCase();
        entries.push({app, cat, cats, text, index: hashOf(appId)});
    }

    entries.sort((a, b) => a.app.get_name().localeCompare(b.app.get_name()));
    return entries;
}

/** Tonal tile color of an app (cycles through three tonal fills). */
export function tintClass(index) {
    return `m3-tint-${index % 3}`;
}
