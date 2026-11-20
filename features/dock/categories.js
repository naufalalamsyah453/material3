// Category configuration shared by the shell (app menu) and the preferences
// window. Must not import anything from gi://Shell or resource:///org/gnome/shell.

/** Built-in category pills (ids, labels as in the reference HTML). */
export const BUILTIN = [
    {id: 'all', label: 'All', builtin: true},
    {id: 'produktivitas', label: 'Productivity', builtin: true},
    {id: 'sistem', label: 'System', builtin: true},
    {id: 'utilitas', label: 'Utilities', builtin: true},
];

/**
 * Parse the `custom-categories` JSON setting.
 *
 * @param {string} json
 * @returns {Array<{id: string, label: string, apps: string[]}>}
 */
export function parseCustom(json) {
    let data;
    try {
        data = JSON.parse(json || '[]');
    } catch {
        return [];
    }
    if (!Array.isArray(data))
        return [];

    const seen = new Set(BUILTIN.map(c => c.id));
    const out = [];
    for (const item of data) {
        if (!item || typeof item.id !== 'string' || typeof item.label !== 'string')
            continue;
        if (seen.has(item.id))
            continue;
        seen.add(item.id);
        out.push({
            id: item.id,
            label: item.label.trim() || item.id,
            apps: Array.isArray(item.apps) ? item.apps.filter(a => typeof a === 'string') : [],
            builtin: false,
        });
    }
    return out;
}

/** @returns {string} the JSON to store for a list of custom categories. */
export function serializeCustom(custom) {
    return JSON.stringify(custom.map(({id, label, apps}) => ({id, label, apps})));
}

/**
 * Every category (built-in + custom) in the user's order, hidden ones
 * included and flagged. "All" is never hidden.
 *
 * @param {Gio.Settings} settings
 * @param {(s: string) => string} [tr] translates the built-in labels
 * @returns {{custom: object[], ordered: Array<object>}}
 */
export function orderedCategories(settings, tr = s => s) {
    const custom = parseCustom(settings.get_string('custom-categories'));
    const byId = new Map([...BUILTIN, ...custom].map(c => [c.id, c]));
    const hidden = new Set(settings.get_strv('hidden-categories'));

    const order = [];
    for (const id of settings.get_strv('category-order')) {
        if (byId.has(id) && !order.includes(id))
            order.push(id);
    }
    for (const id of byId.keys()) {
        if (!order.includes(id))
            order.push(id);
    }

    const ordered = order.map(id => ({
        ...byId.get(id),
        label: byId.get(id).builtin ? tr(byId.get(id).label) : byId.get(id).label,
        hidden: id !== 'all' && hidden.has(id),
    }));
    return {custom, ordered};
}

/**
 * What the app menu needs: the visible pills in order, the custom
 * categories (for app membership), and the favorite category, if the
 * "favorite category" mode is on and points at a visible category.
 *
 * @param {Gio.Settings} settings
 * @param {(s: string) => string} [tr] translates the built-in labels
 * @returns {{list: Array<{id: string, label: string}>, custom: object[], favorite: string|null}}
 */
export function readCategoryConfig(settings, tr = s => s) {
    const {custom, ordered} = orderedCategories(settings, tr);
    const list = ordered.filter(c => !c.hidden).map(({id, label}) => ({id, label}));

    let favorite = null;
    if (settings.get_boolean('favorite-category-enabled')) {
        const id = settings.get_string('favorite-category');
        if (id && id !== 'all' && list.some(c => c.id === id))
            favorite = id;
    }
    return {list, custom, favorite};
}
