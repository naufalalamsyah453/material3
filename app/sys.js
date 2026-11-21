import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * GSettings access that tolerates missing schemas and keys. One shared
 * instance (`gs`) lives as long as the app.
 */
export class Gs {
    constructor() {
        this._settings = new Map();
        this._ids = [];
    }

    /** @returns {?Gio.Settings} */
    settings(schema) {
        if (this._settings.has(schema))
            return this._settings.get(schema);

        let settings = null;
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            const found = source?.lookup(schema, true);
            if (found)
                settings = new Gio.Settings({settings_schema: found});
        } catch (e) {
            console.error(`material3: schema ${schema} unavailable: ${e.message}`);
        }
        this._settings.set(schema, settings);
        return settings;
    }

    has(schema, key) {
        const settings = this.settings(schema);
        return !!settings && settings.settings_schema.has_key(key);
    }

    /** Value of a key, or `fallback` when the schema or key is missing. */
    get(schema, key, fallback = null) {
        if (!this.has(schema, key))
            return fallback;
        try {
            return this.settings(schema).get_value(key).deepUnpack();
        } catch (e) {
            console.error(`material3: cannot read ${schema} ${key}: ${e.message}`);
            return fallback;
        }
    }

    /** Write a key using the type the schema declares. */
    set(schema, key, value) {
        if (!this.has(schema, key))
            return false;
        try {
            const settings = this.settings(schema);
            const type = settings.settings_schema.get_key(key).get_value_type().dup_string();
            const ok = settings.set_value(key, new GLib.Variant(type, value));
            if (!ok)
                console.error(`material3: ${schema} ${key} rejected ${value}`);
            return ok;
        } catch (e) {
            console.error(`material3: cannot write ${schema} ${key}: ${e.message}`);
            return false;
        }
    }

    /** Valid range of a numeric key: [min, max] or null. */
    range(schema, key) {
        if (!this.has(schema, key))
            return null;
        try {
            const range = this.settings(schema).settings_schema.get_key(key).get_range();
            const [kind, data] = range.deepUnpack();
            if (kind !== 'range')
                return null;
            const [min, max] = data.deepUnpack();
            return [min.deepUnpack?.() ?? min, max.deepUnpack?.() ?? max];
        } catch {
            return null;
        }
    }

    watch(schema, key, callback) {
        const settings = this.settings(schema);
        if (!settings || !settings.settings_schema.has_key(key))
            return;
        this._ids.push([settings, settings.connect(`changed::${key}`, callback)]);
    }

    destroy() {
        for (const [settings, id] of this._ids)
            settings.disconnect(id);
        this._ids = [];
        for (const settings of this._settings.values())
            settings?.run_dispose();
        this._settings.clear();
    }
}

/**
 * Run a command and collect its output.
 *
 * @param {string[]} argv
 * @param {object} [options]
 * @param {number} [options.timeout] seconds before the process is killed
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
export function run(argv, {timeout = 0} = {}) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
        } catch (e) {
            resolve({ok: false, stdout: '', stderr: e.message});
            return;
        }

        let timer = 0;
        if (timeout > 0) {
            timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeout, () => {
                timer = 0;
                proc.force_exit();
                return GLib.SOURCE_REMOVE;
            });
        }

        proc.communicate_utf8_async(null, null, (_proc, result) => {
            if (timer)
                GLib.source_remove(timer);
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                resolve({ok: proc.get_successful(), stdout: stdout ?? '', stderr: stderr ?? ''});
            } catch (e) {
                resolve({ok: false, stdout: '', stderr: e.message});
            }
        });
    });
}

/**
 * Proxy for a D-Bus object, resolved asynchronously (null when the service
 * is missing).
 *
 * @returns {Promise<?Gio.DBusProxy>}
 */
export function dbusProxy(bus, name, path, iface) {
    return new Promise(resolve => {
        Gio.DBusProxy.new_for_bus(
            bus, Gio.DBusProxyFlags.NONE, null, name, path, iface, null,
            (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    resolve(proxy.get_name_owner() ? proxy : null);
                } catch {
                    resolve(null);
                }
            });
    });
}

/** Set a property through org.freedesktop.DBus.Properties (polkit may prompt). */
export function setDbusProperty(proxy, name, signature, value) {
    return new Promise(resolve => {
        proxy.call(
            'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [proxy.get_interface_name(), name,
                new GLib.Variant(signature, value)]),
            Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, 5000, null,
            (source, result) => {
                try {
                    source.call_finish(result);
                    resolve(true);
                } catch (e) {
                    console.error(`material3: cannot set ${name}: ${e.message}`);
                    resolve(false);
                }
            });
    });
}

/** Call a method with interactive authorization allowed. */
export function dbusCall(proxy, method, params) {
    return new Promise(resolve => {
        proxy.call(method, params, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, 5000, null,
            (source, result) => {
                try {
                    resolve(source.call_finish(result));
                } catch (e) {
                    console.error(`material3: ${method} failed: ${e.message}`);
                    resolve(null);
                }
            });
    });
}

/** Human readable size, base 1000 like GNOME's Disks. */
export function formatBytes(bytes) {
    const units = ['B', 'kB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    const digits = unit >= 3 && value < 100 ? 1 : 0;
    return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`;
}


/** The shared GSettings accessor. */
export const gs = new Gs();

/** Text of a file, or '' when it cannot be read. */
export function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

/** True when `cmd` is in PATH. */
export function hasCommand(cmd) {
    return GLib.find_program_in_path(cmd) !== null;
}

/** Run `fn` once the main loop is idle (lets the window paint first). */
export function later(fn, priority = GLib.PRIORITY_DEFAULT_IDLE) {
    return GLib.idle_add(priority, () => {
        fn();
        return GLib.SOURCE_REMOVE;
    });
}

/** Debounce: `fn` runs `ms` after the last call. */
export function debounce(fn, ms = 80) {
    let id = 0;
    const wrapped = (...args) => {
        if (id)
            GLib.source_remove(id);
        id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            id = 0;
            fn(...args);
            return GLib.SOURCE_REMOVE;
        });
    };
    wrapped.cancel = () => {
        if (id)
            GLib.source_remove(id);
        id = 0;
    };
    return wrapped;
}

/** Fields of one `nmcli -t` line (colons inside a value are escaped as `\:`). */
export function splitTerse(line) {
    const fields = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\\' && i + 1 < line.length) {
            current += line[++i];
        } else if (c === ':') {
            fields.push(current);
            current = '';
        } else {
            current += c;
        }
    }
    fields.push(current);
    return fields;
}


/** Directory of the extension that ships this app. */
export const EXTENSION_DIR = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();

let extCache;

/** The extension's own GSettings (null when its schema is not compiled). */
export function extSettings() {
    if (extCache !== undefined)
        return extCache;
    extCache = null;
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(
            GLib.build_filenamev([EXTENSION_DIR, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup('org.gnome.shell.extensions.material3', true);
        if (schema)
            extCache = new Gio.Settings({settings_schema: schema});
    } catch (e) {
        console.error(`material3: extension settings unavailable: ${e.message}`);
    }
    return extCache;
}

/**
 * Call `callback` (debounced) whenever `sender` emits a D-Bus signal, so a
 * page can follow changes made elsewhere (Quick Settings, other apps).
 *
 * @param {Gio.BusType} bus
 * @param {string} sender well-known bus name
 * @param {function(): void} callback
 * @param {?string} [iface] restrict to one interface
 * @returns {function(): void} stop watching
 */
export function watchDbus(bus, sender, callback, iface = null) {
    const connection = bus === Gio.BusType.SYSTEM ? Gio.DBus.system : Gio.DBus.session;
    const fire = debounce(callback, 300);
    const id = connection.signal_subscribe(sender, iface, null, null, null, Gio.DBusSignalFlags.NONE, fire);
    return () => connection.signal_unsubscribe(id);
}
