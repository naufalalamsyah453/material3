import GLib from 'gi://GLib';

/*
 * Entry point shared by everything that used to launch GNOME Settings (the
 * dock, the app menu, the Quick Settings gear). While the extension's own
 * Settings window is registered here, those launches open it instead; if it
 * is not (feature disabled), they fall back to gnome-control-center.
 */

const SETTINGS_IDS = new Set(['org.gnome.Settings.desktop', 'gnome-control-center.desktop']);

let api = null;
let appCommand = null;
const listeners = new Set();

/**
 * @param {?{open: function(?string): void, toggle: function(): void,
 *   state: function(): string}} value
 */
export function setSettingsApi(value) {
    api = value;
    notifySettingsState();
}

export function settingsApi() {
    return api;
}

export function notifySettingsState() {
    for (const listener of [...listeners])
        listener();
}

/** @returns {function(): void} unsubscribe */
export function onSettingsState(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** True for the stock GNOME Settings application. */
export function isSettingsApp(app) {
    return SETTINGS_IDS.has(app?.get_id?.());
}

/** argv of the Material 3 Settings app, or null while the feature is off. */
export function setAppCommand(argv) {
    appCommand = argv;
}

/**
 * Open the Settings window (at `tab`), or the stock app when the window
 * feature is off.
 *
 * @param {?string} [tab]
 */
export function openSettings(tab = null) {
    if (api)
        api.open(tab);
    else if (appCommand && (!tab || /^[a-z0-9-]+$/.test(tab)))
        GLib.spawn_async(null, tab ? [...appCommand, tab] : appCommand, null, GLib.SpawnFlags.SEARCH_PATH, null);
    else
        openStockSettings(tab);
}

/** Activate an app; the stock Settings app opens the replacement window. */
export function activateApp(app) {
    if (api && isSettingsApp(app))
        api.open(null);
    else
        app.activate();
}

/** Launch gnome-control-center itself, bypassing the replacement. */
export function openStockSettings(panel = null) {
    const safe = panel && /^[a-z0-9-]+$/.test(panel) ? ` ${panel}` : '';
    GLib.spawn_command_line_async(`gnome-control-center${safe}`);
}
