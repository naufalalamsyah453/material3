import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {setTranslator} from './i18n.js';
import {DesktopFeature} from './features/desktop/index.js';
import {DateMenuFeature} from './features/dateMenu/index.js';
import {DockFeature} from './features/dock/index.js';
import {OsdFeature} from './features/osd/index.js';
import {QuickSettingsPanel} from './features/quickSettings/panel.js';
import {SettingsFeature} from './features/settings/index.js';
import {SwitcherFeature} from './features/switcher/index.js';

export default class Material3Extension extends Extension {
    enable() {
        this.initTranslations();
        setTranslator(s => this.gettext(s));
        const settings = this.getSettings();
        this._settings = settings;

        this._quickSettings = null;
        this._qsId = settings.connect('changed::show-quicksettings', () => this._syncQuickSettings());
        this._syncQuickSettings();

        this._dock = new DockFeature(settings);
        this._dock.enable();

        this._settingsApp = new SettingsFeature(settings, this.path);
        this._settingsApp.enable();

        this._dateMenu = null;
        this._dateMenuId = settings.connect('changed::show-datemenu', () => this._syncDateMenu());
        this._syncDateMenu();

        this._desktop = null;
        this._desktopId = settings.connect('changed::show-desktop-icons', () => this._syncDesktop());
        this._syncDesktop();

        this._switcher = null;
        this._switcherId = settings.connect('changed::show-switcher', () => this._syncSwitcher());
        this._syncSwitcher();

        this._osd = null;
        this._osdId = settings.connect('changed::osd-enabled', () => this._syncOsd());
        this._syncOsd();
    }

    disable() {
        setTranslator(null);
        if (this._qsId)
            this._settings.disconnect(this._qsId);
        this._qsId = 0;
        if (this._osdId)
            this._settings.disconnect(this._osdId);
        this._osdId = 0;
        this._osd?.disable();
        this._osd = null;
        if (this._dateMenuId)
            this._settings.disconnect(this._dateMenuId);
        this._dateMenuId = 0;
        this._dateMenu?.disable();
        this._dateMenu = null;
        if (this._desktopId)
            this._settings.disconnect(this._desktopId);
        this._desktopId = 0;
        this._desktop?.disable();
        this._desktop = null;
        if (this._switcherId)
            this._settings.disconnect(this._switcherId);
        this._switcherId = 0;
        this._switcher?.disable();
        this._switcher = null;

        this._settingsApp?.disable();
        this._settingsApp = null;
        this._dock?.disable();
        this._dock = null;
        this._quickSettings?.disable();
        this._quickSettings = null;
        this._settings = null;
    }

    /** Material 3 Quick Settings, replacing the shell's own panel; off restores GNOME's. */
    _syncQuickSettings() {
        const schema = this._settings.settings_schema;
        const wanted = !schema.has_key('show-quicksettings') || this._settings.get_boolean('show-quicksettings');
        try {
            if (wanted && !this._quickSettings) {
                this._quickSettings = new QuickSettingsPanel(this._settings, this.dir);
                this._quickSettings.enable();
            } else if (!wanted && this._quickSettings) {
                this._quickSettings.disable();
                this._quickSettings = null;
            }
        } catch (e) {
            console.error(`material3: Quick Settings failed: ${e.message}\n${e.stack}`);
        }
    }

    /** Material 3 date menu (notifications, calendar, clocks, weather). */
    _syncDateMenu() {
        const schema = this._settings.settings_schema;
        const wanted = !schema.has_key('show-datemenu') || this._settings.get_boolean('show-datemenu');
        try {
            if (wanted && !this._dateMenu) {
                this._dateMenu = new DateMenuFeature(this._settings);
                this._dateMenu.enable();
            } else if (!wanted && this._dateMenu) {
                this._dateMenu.disable();
                this._dateMenu = null;
            }
        } catch (e) {
            console.error(`material3: date menu failed: ${e.message}\n${e.stack}`);
            try {
                this._dateMenu?.disable();
            } catch {
                // Nothing left to undo.
            }
            this._dateMenu = null;
        }
    }

    /** Desktop icons drawn by the extension (no other extension needed). */
    _syncDesktop() {
        const schema = this._settings.settings_schema;
        const wanted = !schema.has_key('show-desktop-icons') || this._settings.get_boolean('show-desktop-icons');
        try {
            if (wanted && !this._desktop) {
                this._desktop = new DesktopFeature(this._settings);
                this._desktop.enable();
            } else if (!wanted && this._desktop) {
                this._desktop.disable();
                this._desktop = null;
            }
        } catch (e) {
            console.error(`material3: desktop icons failed: ${e.message}\n${e.stack}`);
            try {
                this._desktop?.disable();
            } catch {
                // Nothing left to undo.
            }
            this._desktop = null;
        }
    }

    /** Material 3 Alt+Tab switcher, replacing the shell's own. */
    _syncSwitcher() {
        const schema = this._settings.settings_schema;
        const wanted = !schema.has_key('show-switcher') || this._settings.get_boolean('show-switcher');
        try {
            if (wanted && !this._switcher) {
                this._switcher = new SwitcherFeature(this._settings);
                this._switcher.enable();
            } else if (!wanted && this._switcher) {
                this._switcher.disable();
                this._switcher = null;
            }
        } catch (e) {
            console.error(`material3: switcher failed: ${e.message}\n${e.stack}`);
            this._switcher = null;
        }
    }

    /** Material 3 volume / brightness indicator, replacing the shell's own. */
    _syncOsd() {
        // A schema compiled before this key existed must not break the rest.
        const schema = this._settings.settings_schema;
        const wanted = schema.has_key('osd-enabled')
            ? this._settings.get_boolean('osd-enabled')
            : true;

        try {
            if (wanted && !this._osd) {
                this._osd = new OsdFeature(this._settings);
                this._osd.enable();
            } else if (!wanted && this._osd) {
                this._osd.disable();
                this._osd = null;
            }
        } catch (e) {
            console.error(`material3: OSD failed to start: ${e.message}\n${e.stack}`);
            try {
                this._osd?.disable();
            } catch {
                // Nothing left to undo.
            }
            this._osd = null;
        }
    }
}
