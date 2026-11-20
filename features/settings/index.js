import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {setAppCommand} from './launcher.js';

const APP_ID = 'org.gnome.Settings';
const WM_CLASS = 'io.github.material3.Settings';
const MARK = 'X-Material3-Managed=true';
const SEARCH = 'org.gnome.desktop.search-providers';

/**
 * Material 3 replacement for GNOME Settings. The window itself is a separate
 * GTK 4 app (`app/main.js`), so the compositor tiles, snaps and resizes it
 * like any other window. This feature only makes the system launch it:
 * a user-level `org.gnome.Settings.desktop` overrides the stock entry, the
 * stock panel entries are hidden, and the stock search provider is disabled.
 * Everything is removed again when the feature or extension is turned off.
 */
export class SettingsFeature {
    /**
     * @param {Gio.Settings} extSettings
     * @param {string} extensionPath directory of the extension
     */
    constructor(extSettings, extensionPath) {
        this._ext = extSettings;
        this._path = extensionPath;
        this._ids = [];
        this._appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
    }

    enable() {
        this._ids.push(this._ext.connect('changed::show-settings', () => this._apply()));
        this._ids.push(this._ext.connect('changed::anim-scale', () => this._applySpeed()));
        this._apply();
        this._applySpeed();
    }

    disable() {
        for (const id of this._ids)
            this._ext.disconnect(id);
        this._ids = [];
        this._uninstall();
        setAppCommand(null);
        St.Settings.get().slow_down_factor = 1;
    }

    _apply() {
        if (this._ext.get_boolean('show-settings'))
            this._install();
        else
            this._uninstall();
    }

    _write(name, text) {
        const path = GLib.build_filenamev([this._appsDir, name]);
        try {
            GLib.mkdir_with_parents(this._appsDir, 0o755);
            const file = Gio.File.new_for_path(path);
            let same = false;
            try {
                const [ok, bytes] = file.load_contents(null);
                same = ok && new TextDecoder().decode(bytes) === text;
            } catch {
                // Not there yet.
            }
            if (!same)
                file.replace_contents(new TextEncoder().encode(text), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error(`material3: cannot write ${path}: ${e.message}`);
        }
    }

    /** Names of the stock panel launchers (org.gnome.Settings-*.desktop). */
    _panelEntries() {
        const names = new Set();
        for (const dir of GLib.get_system_data_dirs()) {
            const base = GLib.build_filenamev([dir, 'applications']);
            try {
                const enumerator = Gio.File.new_for_path(base).enumerate_children(
                    'standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null))) {
                    const name = info.get_name();
                    if (name.startsWith(`${APP_ID}-`) && name.endsWith('.desktop'))
                        names.add(name);
                }
                enumerator.close(null);
            } catch {
                // Directory missing.
            }
        }
        return names;
    }

    _install() {
        const exec = `gjs -m "${GLib.build_filenamev([this._path, 'app', 'main.js'])}"`;
        this._write(`${APP_ID}.desktop`, [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Settings',
            'Comment=Material 3 settings for your system',
            `Exec=${exec} %U`,
            `Icon=${APP_ID}`,
            'Terminal=false',
            'Categories=GNOME;GTK;Settings;X-GNOME-Settings-Panel;',
            `StartupWMClass=${WM_CLASS}`,
            'StartupNotify=true',
            MARK,
            '',
        ].join('\n'));
        for (const name of this._panelEntries())
            this._write(name, `[Desktop Entry]\nType=Application\nName=Hidden\nHidden=true\n${MARK}\n`);
        setAppCommand(['gjs', '-m', GLib.build_filenamev([this._path, 'app', 'main.js'])]);
        this._searchProvider(true);
    }

    _uninstall() {
        setAppCommand(null);
        try {
            const enumerator = Gio.File.new_for_path(this._appsDir).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (!name.startsWith(APP_ID) || !name.endsWith('.desktop'))
                    continue;
                const file = Gio.File.new_for_path(GLib.build_filenamev([this._appsDir, name]));
                try {
                    const [ok, bytes] = file.load_contents(null);
                    if (ok && new TextDecoder().decode(bytes).includes(MARK))
                        file.delete(null);
                } catch {
                    // Not ours, or already gone.
                }
            }
            enumerator.close(null);
        } catch {
            // No user applications directory.
        }
        this._searchProvider(false);
    }

    /** Keep the stock Settings out of overview search while ours is active. */
    _searchProvider(hide) {
        try {
            const settings = new Gio.Settings({schema_id: SEARCH});
            const disabled = settings.get_strv('disabled');
            const id = `${APP_ID}.desktop`;
            const have = disabled.includes(id);
            const added = this._ext.get_boolean('settings-search-hidden');
            if (hide && !have) {
                settings.set_strv('disabled', [...disabled, id]);
                this._ext.set_boolean('settings-search-hidden', true);
            } else if (!hide && have && added) {
                settings.set_strv('disabled', disabled.filter(v => v !== id));
                this._ext.set_boolean('settings-search-hidden', false);
            }
            settings.run_dispose();
        } catch (e) {
            console.error(`material3: search provider: ${e.message}`);
        }
    }

    /** 0 = animations off (GNOME's own switch); otherwise scale the shell's speed. */
    _applySpeed() {
        const scale = this._ext.get_double('anim-scale');
        St.Settings.get().slow_down_factor = scale > 0 ? 1 / scale : 1;
    }
}
