import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {setTranslator} from './i18n.js';
import {DockFeature} from './features/dock/index.js';
import {OsdFeature} from './features/osd/index.js';
import {QuickSettingsPanel} from './features/quickSettings/panel.js';
import {SettingsFeature} from './features/settings/index.js';

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
