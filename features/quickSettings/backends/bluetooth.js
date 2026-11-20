import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Backend, SignalBag} from './base.js';
import {_} from '../../../i18n.js';

const RFKILL_XML = `
<node>
  <interface name="org.gnome.SettingsDaemon.Rfkill">
    <property name="BluetoothAirplaneMode" type="b" access="readwrite"/>
    <property name="BluetoothHasAirplaneMode" type="b" access="read"/>
    <property name="BluetoothHardwareAirplaneMode" type="b" access="read"/>
  </interface>
</node>`;
const rfkillInfo = Gio.DBusInterfaceInfo.new_for_xml(RFKILL_XML);

/**
 * Bluetooth power and connected devices through GnomeBluetooth, switched
 * the same way the stock toggle does (rfkill airplane mode).
 */
export class BluetoothBackend extends Backend {
    constructor() {
        super();

        this._BT = null;
        this._client = null;
        this._proxy = null;
        this._deviceSignals = new SignalBag();

        this._init().catch(e => console.error(`material3: bluetooth unavailable: ${e.message}`));
    }

    get state() {
        const client = this._client;
        if (!client)
            return {active: false, subtitle: _('Unavailable'), available: false};

        const absent = client.default_adapter_state === this._BT.AdapterState.ABSENT;
        const active = client.default_adapter_powered;
        const connected = active ? this._devices().filter(d => d.connected) : [];

        let subtitle = active ? _('On') : _('Off');
        if (connected.length === 1)
            subtitle = connected[0].alias;
        else if (connected.length > 1)
            subtitle = _('%d Connected').format(connected.length);

        const canSwitch = !!this._proxy?.BluetoothHasAirplaneMode &&
            !this._proxy?.BluetoothHardwareAirplaneMode;

        return {active, subtitle, available: !absent && canSwitch};
    }

    /** Provider for the right-click pane: paired devices. */
    get options() {
        return {
            title: _('Bluetooth'),
            icon: 'bluetooth',
            subscribe: cb => this.subscribe(cb),
            getOptions: () => this._options(),
        };
    }

    toggle() {
        if (!this._client || !this._proxy)
            return;

        const active = this._client.default_adapter_powered;
        this._proxy.BluetoothAirplaneMode = active;
        if (!this._client.default_adapter_powered)
            this._client.default_adapter_powered = true;
    }

    async _init() {
        const BT = (await import('gi://GnomeBluetooth?version=3.0')).default;
        if (this._destroyed)
            return;
        this._BT = BT;

        this._proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: 'org.gnome.SettingsDaemon.Rfkill',
            g_object_path: '/org/gnome/SettingsDaemon/Rfkill',
            g_interface_name: rfkillInfo.name,
            g_interface_info: rfkillInfo,
        });
        this._proxy.connect('g-properties-changed', () => this._emit());
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, null)
            .then(() => this._emit())
            .catch(e => console.error(`material3: rfkill proxy: ${e.message}`));

        this._client = new BT.Client();
        for (const name of ['notify::default-adapter-powered',
            'notify::default-adapter-state', 'notify::default-adapter'])
            this._signals.connect(this._client, name, () => this._emit());
        this._signals.connect(this._client, 'device-added', () => this._watchDevices());
        this._signals.connect(this._client, 'device-removed', () => this._watchDevices());
        this._watchDevices();
    }

    _options() {
        if (!this._client)
            return {items: [], emptyText: _('Bluetooth is unavailable')};
        if (!this._client.default_adapter_powered)
            return {items: [], emptyText: _('Bluetooth is off')};

        const items = this._devices()
            .filter(d => d.paired || d.trusted)
            .sort((a, b) => (b.connected - a.connected) || a.alias.localeCompare(b.alias))
            .map(device => ({
                id: device.get_object_path(),
                icon: device.connected ? 'bluetooth_connected' : 'bluetooth',
                label: device.alias,
                sublabel: device.connected ? _('Connected') : _('Paired'),
                selected: device.connected,
                activate: () => this._toggleDevice(device),
            }));

        return {items, emptyText: _('No paired devices')};
    }

    _toggleDevice(device) {
        const connect = !device.connected;
        this._client.connect_service(device.get_object_path(), connect, null,
            (client, result) => {
                try {
                    client.connect_service_finish(result);
                } catch (e) {
                    console.error(`material3: failed to ${connect ? 'connect' : 'disconnect'} ` +
                        `"${device.name}": ${e.message}`);
                }
            });
    }

    _devices() {
        const store = this._client.get_devices();
        const devices = [];
        for (let i = 0; i < store.get_n_items(); i++)
            devices.push(store.get_item(i));
        return devices;
    }

    _watchDevices() {
        this._deviceSignals.clear();
        for (const device of this._devices()) {
            this._deviceSignals.connect(device, 'notify::connected', () => this._emit());
            this._deviceSignals.connect(device, 'notify::alias', () => this._emit());
            this._deviceSignals.connect(device, 'notify::paired', () => this._emit());
            this._deviceSignals.connect(device, 'notify::trusted', () => this._emit());
        }
        this._emit();
    }

    _onDestroy() {
        this._deviceSignals.clear();
        this._client = null;
        this._proxy = null;
    }
}
