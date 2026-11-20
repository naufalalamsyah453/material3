import Gio from 'gi://Gio';

import {Backend} from './base.js';
import {_} from '../../../i18n.js';

const PROFILES_XML = `
<node>
  <interface name="org.freedesktop.UPower.PowerProfiles">
    <property name="ActiveProfile" type="s" access="readwrite"/>
    <property name="Profiles" type="aa{sv}" access="read"/>
  </interface>
</node>`;
const DEVICE_XML = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
  </interface>
</node>`;

const UPOWER_XML = `
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER_XML);
const ProfilesProxy = Gio.DBusProxy.makeProxyWrapper(PROFILES_XML);
const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DEVICE_XML);

const PROFILE_DETAILS = {
    'performance': {icon: 'bolt', hint: _('Maximum performance')},
    'balanced': {icon: 'balance', hint: _('Standard performance and battery')},
    'power-saver': {icon: 'eco', hint: _('Longer battery life')},
};

const PROFILE_NAMES = {
    'performance': _('Performance'),
    'balanced': _('Balanced'),
    'power-saver': _('Power Saver'),
};

/**
 * Power Mode: power-saver on, balanced off, plus the battery percentage in
 * the subtitle ("86% • Balanced").
 */
export class PowerBackend extends Backend {
    constructor() {
        super();

        this._profiles = new ProfilesProxy(Gio.DBus.system,
            'org.freedesktop.UPower.PowerProfiles',
            '/org/freedesktop/UPower/PowerProfiles',
            (proxy, error) => {
                if (error) {
                    console.error(`material3: power profiles: ${error.message}`);
                    return;
                }
                proxy.connect('g-properties-changed', () => this._emit());
                this._emit();
            });

        this._upower = new UPowerProxy(Gio.DBus.system,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower',
            (proxy, error) => {
                if (!error)
                    proxy.connect('g-properties-changed', () => this._emit());
            });

        this._battery = new DeviceProxy(Gio.DBus.system,
            'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice',
            (proxy, error) => {
                if (error)
                    return;
                proxy.connect('g-properties-changed', () => this._emit());
                this._emit();
            });
    }

    get state() {
        const profile = this._profiles?.ActiveProfile ?? 'balanced';
        const name = PROFILE_NAMES[profile] ?? profile;
        const hasBattery = this._battery?.IsPresent;

        return {
            active: profile !== 'balanced',
            subtitle: hasBattery
                ? `${Math.round(this._battery.Percentage)}% • ${name}`
                : name,
            available: !!this._profiles?.g_name_owner,
        };
    }

    /** Active profile id: performance, balanced or power-saver. */
    get profile() {
        return this._profiles?.ActiveProfile ?? 'balanced';
    }

    /** Provider for the right-click pane: available power modes. */
    get options() {
        return {
            title: _('Power Mode'),
            icon: 'battery_saver',
            fitContent: true,
            subscribe: cb => this.subscribe(cb),
            getOptions: () => this._options(),
        };
    }

    /**
     * Click: plugged in switches to Performance, on battery to Power Saver;
     * clicking again (already on that profile) returns to Balanced.
     */
    toggle() {
        if (!this._profiles)
            return;
        const available = (this._profiles.Profiles ?? []).map(p => p.Profile.unpack());
        const wanted = this._upower?.OnBattery ? 'power-saver' : 'performance';
        const target = available.length === 0 || available.includes(wanted) ? wanted : 'power-saver';
        this._profiles.ActiveProfile = this._profiles.ActiveProfile === target ? 'balanced' : target;
    }

    _options() {
        if (!this._profiles?.g_name_owner)
            return {items: [], emptyText: _('Power profiles are unavailable')};

        const active = this._profiles.ActiveProfile;
        const names = (this._profiles.Profiles ?? []).map(p => p.Profile.unpack()).reverse();

        const items = names
            .filter(name => PROFILE_DETAILS[name])
            .map(name => ({
                id: name,
                icon: PROFILE_DETAILS[name].icon,
                label: PROFILE_NAMES[name],
                sublabel: PROFILE_DETAILS[name].hint,
                selected: name === active,
                closeOnActivate: true,
                activate: () => {
                    this._profiles.ActiveProfile = name;
                },
            }));

        return {items, emptyText: _('No power modes available')};
    }

    _onDestroy() {
        this._profiles = null;
        this._battery = null;
        this._upower = null;
    }
}
