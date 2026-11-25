import GLib from 'gi://GLib';

import {Backend, SignalBag} from './base.js';
import {_} from '../../../i18n.js';
import {openSettings} from '../../settings/launcher.js';

/**
 * @param {number} strength 0..100
 * @returns {string} Material Symbols name
 */
// The bundled icon font has no per-bar Wi-Fi glyphs: a missing ligature
// would show up as clipped text, so only icons that exist are used.
function wifiIcon(strength) {
    return strength < 50 ? 'network_wifi' : 'wifi';
}

/** Wi-Fi radio switch and active network name through NetworkManager. */
export class WifiBackend extends Backend {
    constructor() {
        super();

        this._NM = null;
        this._client = null;
        this._deviceSignals = new SignalBag();

        this._init().catch(e => console.error(`material3: wifi unavailable: ${e.message}`));
    }

    get state() {
        const client = this._client;
        if (!client)
            return {active: false, subtitle: _('Unavailable'), available: false};

        const hasDevice = this._wifiDevices().length > 0;
        const active = client.wireless_enabled;
        let subtitle = _('Off');
        if (active)
            subtitle = this._activeSsid() ?? _('Not connected');

        return {
            active,
            subtitle,
            available: hasDevice && client.wireless_hardware_enabled,
        };
    }

    /** Provider for the right-click pane: networks in range. */
    get options() {
        return {
            title: _('Wi-Fi'),
            settingsPage: 'network',
            getState: () => this.state,
            toggle: () => this.toggle(),
            icon: 'wifi',
            subscribe: cb => this.subscribe(cb),
            onOpen: () => this._scan(),
            getOptions: () => this._options(),
        };
    }

    toggle(target) {
        const client = this._client;
        if (!client)
            return;

        client.dbus_set_property(
            this._NM.DBUS_PATH,
            this._NM.DBUS_INTERFACE,
            'WirelessEnabled',
            new GLib.Variant('b', target ?? !client.wireless_enabled),
            2000,
            null,
            (source, result) => {
                try {
                    source.dbus_set_property_finish(result);
                } catch (e) {
                    console.error(`material3: failed to toggle Wi-Fi: ${e.message}`);
                }
            });
    }

    async _init() {
        const NM = (await import('gi://NM')).default;
        this._NM = NM;

        const client = await new Promise((resolve, reject) => {
            NM.Client.new_async(null, (_source, result) => {
                try {
                    resolve(NM.Client.new_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
        });

        if (this._destroyed)
            return;

        this._client = client;
        this._signals.connect(client, 'notify::wireless-enabled', () => this._emit());
        this._signals.connect(client, 'notify::wireless-hardware-enabled', () => this._emit());
        this._signals.connect(client, 'device-added', () => this._watchDevices());
        this._signals.connect(client, 'device-removed', () => this._watchDevices());
        this._watchDevices();
    }

    _options() {
        const client = this._client;
        if (!client)
            return {items: [], emptyText: _('Wi-Fi is unavailable')};
        if (!client.wireless_enabled)
            return {items: [], emptyText: _('Wi-Fi is off')};

        const NM = this._NM;
        const activeName = this._activeSsid();
        const best = new Map();

        for (const device of this._wifiDevices()) {
            for (const ap of device.get_access_points()) {
                const ssid = ap.get_ssid();
                const name = ssid ? NM.utils_ssid_to_utf8(ssid.get_data()) : null;
                if (!name)
                    continue;
                const prev = best.get(name);
                if (!prev || ap.strength > prev.ap.strength)
                    best.set(name, {ap, device, name});
            }
        }

        const items = [...best.values()]
            .sort((a, b) => (b.name === activeName) - (a.name === activeName) ||
                b.ap.strength - a.ap.strength)
            .map(({ap, device, name}) => {
                const connected = name === activeName;
                const secured = this._isSecured(ap);
                return {
                    id: name,
                    icon: wifiIcon(ap.strength),
                    label: name,
                    sublabel: connected ? _('Connected') : secured ? _('Secured') : _('Open'),
                    selected: connected,
                    trailing: secured ? 'lock' : null,
                    activate: () => this._connect(ap, device, connected),
                };
            });

        return {items, emptyText: _('No networks found')};
    }

    _isSecured(ap) {
        return !!(ap.flags & this._NM['80211ApFlags'].PRIVACY) ||
            ap.wpa_flags !== 0 || ap.rsn_flags !== 0;
    }

    _isEnterprise(ap) {
        const flag = this._NM['80211ApSecurityFlags'].KEY_MGMT_802_1X;
        return !!((ap.wpa_flags | ap.rsn_flags) & flag);
    }

    /** Same activation paths as the stock network item. */
    _connect(ap, device, connected) {
        const NM = this._NM;
        const client = this._client;

        if (connected) {
            device.disconnect_async(null, null);
            return;
        }

        const known = client.get_connections().find(c => ap.connection_valid(c));
        if (known) {
            client.activate_connection_async(known, device, null, null, null);
        } else if (this._isEnterprise(ap)) {
            // Needs 802.1x credentials: hand over to Settings.
            openSettings('network');
        } else {
            // The shell's secret agent prompts for a password if needed.
            const connection = new NM.SimpleConnection();
            const setting = new NM.SettingConnection();
            setting.add_permission('user', GLib.get_user_name(), null);
            connection.add_setting(setting);
            client.add_and_activate_connection_async(connection, device, ap.get_path(), null, null);
        }
    }

    _scan() {
        for (const device of this._wifiDevices()) {
            try {
                device.request_scan_async(null, null)?.catch?.(() => {});
            } catch {
                // Scanning too often is rejected by NetworkManager; ignore.
            }
        }
    }

    _wifiDevices() {
        if (!this._client)
            return [];
        return this._client.get_devices()
            .filter(d => d.get_device_type() === this._NM.DeviceType.WIFI);
    }

    _watchDevices() {
        this._deviceSignals.clear();
        for (const device of this._wifiDevices()) {
            this._deviceSignals.connect(device, 'notify::active-access-point', () => this._emit());
            this._deviceSignals.connect(device, 'notify::state', () => this._emit());
            this._deviceSignals.connect(device, 'access-point-added', () => this._emit());
            this._deviceSignals.connect(device, 'access-point-removed', () => this._emit());
        }
        this._emit();
    }

    _activeSsid() {
        for (const device of this._wifiDevices()) {
            const ssid = device.get_active_access_point()?.get_ssid();
            if (ssid)
                return this._NM.utils_ssid_to_utf8(ssid.get_data());
        }
        return null;
    }

    _onDestroy() {
        this._deviceSignals.clear();
        this._client = null;
    }
}

