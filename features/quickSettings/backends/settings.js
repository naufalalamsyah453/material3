import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from '../../../i18n.js';

import {Backend} from './base.js';

/**
 * @param {string} schemaId
 * @returns {boolean}
 */
function hasSchema(schemaId) {
    return !!Gio.SettingsSchemaSource.get_default()?.lookup(schemaId, true);
}

/** A boolean GSettings key exposed as a toggle. */
class BooleanSettingBackend extends Backend {
    constructor({schema, key, invert = false, onText, offText}) {
        super();

        this._key = key;
        this._invert = invert;
        this._onText = onText;
        this._offText = offText;
        this._settings = null;

        if (!hasSchema(schema))
            return;

        this._settings = new Gio.Settings({schema_id: schema});
        this._signals.connect(this._settings, `changed::${key}`, () => this._emit());
    }

    get active() {
        if (!this._settings)
            return false;
        return this._settings.get_boolean(this._key) !== this._invert;
    }

    get state() {
        const active = this.active;
        return {
            active,
            subtitle: active ? this._onText : this._offText,
            available: this._settings !== null,
        };
    }

    toggle() {
        this._settings?.set_boolean(this._key, this.active === this._invert);
    }

    _onDestroy() {
        this._settings?.run_dispose();
        this._settings = null;
    }
}

export class DoNotDisturbBackend extends BooleanSettingBackend {
    constructor() {
        super({
            schema: 'org.gnome.desktop.notifications',
            key: 'show-banners',
            invert: true,
            onText: _('On'),
            offText: _('Off'),
        });
    }
}

export class NightLightBackend extends BooleanSettingBackend {
    constructor() {
        super({
            schema: 'org.gnome.settings-daemon.plugins.color',
            key: 'night-light-enabled',
            onText: _('On'),
            offText: _('Off'),
        });
    }
}

/** Dark style via the interface color-scheme, like the stock toggle. */
export class DarkStyleBackend extends Backend {
    constructor() {
        super();

        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._signals.connect(this._settings, 'changed::color-scheme', () => this._emit());
    }

    get state() {
        const dark = this._settings.get_string('color-scheme') === 'prefer-dark';
        return {
            active: dark,
            subtitle: dark ? _('On (Dark)') : _('Off (Light)'),
            icon: dark ? 'light_mode' : 'dark_mode',
            available: true,
        };
    }

    toggle() {
        const dark = this._settings.get_string('color-scheme') === 'prefer-dark';
        Main.layoutManager.screenTransition.run();
        this._settings.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
    }

    _onDestroy() {
        this._settings.run_dispose();
    }
}
