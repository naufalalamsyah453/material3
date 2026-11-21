import Gio from 'gi://Gio';

import {_} from '../i18n.js';
import {gs, hasCommand, run, splitTerse, watchDbus} from '../sys.js';
import {
    askText, card, clearBox, customSwitch, fire, gsSelect, gsEntry, heading, iconButton, label, listCard, note,
    pillButton, row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

const PROXY = 'org.gnome.system.proxy';

function bars(signal) {
    return signal > 50 ? 'wifi' : 'network_wifi';
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Wi-Fi & Network'), _('Wi-Fi, wired connections, VPN and proxy')));

    if (!hasCommand('nmcli')) {
        page.append(note(_('NetworkManager (nmcli) was not found on this system.'), 'wifi_off'));
        return page;
    }

    const wifiList = vbox(0);
    const wiredList = vbox(0);
    const vpnList = vbox(0);

    const wifi = customSwitch({
        title: _('Wi-Fi'), icon: 'wifi',
        get: () => false,
        set: on => fire(run(['nmcli', 'radio', 'wifi', on ? 'on' : 'off']).then(() => {
            setTimeout(() => page.refresh(), 1500);
        })),
    });
    const airplane = customSwitch({
        title: _('Airplane mode'), sub: _('Turns off Wi-Fi and Bluetooth'), icon: 'flight',
        get: () => false,
        set: on => fire(run(['nmcli', 'radio', 'all', on ? 'off' : 'on']).then(() => page.refresh())),
    });
    page.append(listCard([wifi, airplane]));

    page.append(sectionLabel(_('Wi-Fi networks')));
    const wifiCard = vbox(0, 'm3-card list');
    wifiCard.append(wifiList);
    page.append(wifiCard);
    page.append(sectionLabel(_('Wired')));
    const wiredCard = vbox(0, 'm3-card list');
    wiredCard.append(wiredList);
    page.append(wiredCard);
    page.append(sectionLabel('VPN'));
    const vpnCard = vbox(0, 'm3-card list');
    vpnCard.append(vpnList);
    page.append(vpnCard);

    page.append(sectionLabel(_('Proxy')));
    page.append(listCard([
        gsSelect({
            schema: PROXY, key: 'mode', title: _('Proxy'), icon: 'lan',
            options: [['none', _('Off')], ['manual', _('Manual')], ['auto', _('Automatic')]],
        }),
        gsEntry({schema: PROXY, key: 'autoconfig-url', title: _('Configuration URL'), icon: 'link', width: 260}),
    ]));
    page.append(listCard([
        row({
            title: _('Advanced network settings'),
            sub: _('Edit connections, IP and DNS'),
            icon: 'settings_ethernet',
            trailing: pillButton(_('Open'), () => {
                run(['sh', '-c', 'nm-connection-editor || gnome-control-center network']);
            }, {variant: 'tonal'}),
        }),
    ].filter(Boolean)));

    const connectWifi = async ssid => {
        let result = await run(['nmcli', '-w', '30', 'connection', 'up', 'id', ssid]);
        if (!result.ok) {
            const password = await askText({
                title: _('Connect to %s').format(ssid), message: _('Password'), password: true,
                okLabel: _('Connect'),
            });
            if (password === null)
                return;
            result = await run(['nmcli', '-w', '30', 'device', 'wifi', 'connect', ssid, 'password', password]);
        }
        toast(result.ok ? _('Connected to %s').format(ssid) : _('Could not connect'));
        page.refresh();
    };

    const readRadio = async () => {
        const radio = await run(['nmcli', '-t', '-f', 'WIFI,WWAN', 'radio']);
        const on = radio.stdout.trim().startsWith('enabled');
        wifi.setActive(on);
        airplane.setActive(!on);
        return on;
    };

    const fill = async () => {
        // The switches follow the radio first; the slower scan fills in after.
        const radioOn = readRadio();
        const [wifis, conns] = await Promise.all([
            run(['nmcli', '-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list']),
            run(['nmcli', '-t', '-f', 'NAME,TYPE,DEVICE,ACTIVE', 'connection', 'show']),
        ]);
        const wifiOn = await radioOn;

        clearBox(wifiList);
        const seen = new Set();
        const entries = wifis.stdout.split('\n').filter(Boolean).map(splitTerse)
            .filter(([, ssid]) => ssid && !seen.has(ssid) && seen.add(ssid))
            .sort((a, b) => Number(b[2]) - Number(a[2]));
        if (!wifiOn)
            wifiList.append(row({title: _('Wi-Fi is off'), icon: 'wifi_off'}));
        else if (entries.length === 0)
            wifiList.append(row({title: _('No networks found'), icon: 'wifi_find'}));
        for (const [use, ssid, signal, security] of entries.slice(0, 20)) {
            const active = use === '*';
            wifiList.append(row({
                title: ssid,
                sub: [active ? _('Connected') : '', security && security !== '--' ? security : _('Open')]
                    .filter(Boolean).join(' · '),
                icon: bars(Number(signal)),
                trailing: active
                    ? pillButton(_('Disconnect'), () => fire(
                        run(['nmcli', 'connection', 'down', 'id', ssid]).then(() => page.refresh())))
                    : pillButton(_('Connect'), () => fire(connectWifi(ssid)), {variant: 'tonal'}),
            }));
        }

        const rows = conns.stdout.split('\n').filter(Boolean).map(splitTerse);
        clearBox(wiredList);
        clearBox(vpnList);
        for (const [name, type, device, active] of rows) {
            const on = active === 'yes';
            const kind = type.includes('ethernet') ? wiredList : /vpn|wireguard/.test(type) ? vpnList : null;
            if (!kind)
                continue;
            kind.append(row({
                title: name, sub: on ? `${_('Connected')}${device ? ` · ${device}` : ''}` : _('Not connected'),
                icon: kind === vpnList ? 'vpn_key' : 'settings_ethernet',
                trailing: pillButton(on ? _('Disconnect') : _('Connect'), () => fire(
                    run(['nmcli', 'connection', on ? 'down' : 'up', 'id', name]).then(r => {
                        toast(r.ok ? _('Settings updated') : _('Could not connect'));
                        page.refresh();
                    })), {variant: on ? '' : 'tonal'}),
            }));
        }
        if (!wiredList.get_first_child())
            wiredList.append(row({title: _('No wired connection'), icon: 'settings_ethernet'}));
        if (!vpnList.get_first_child())
            vpnList.append(row({title: _('No VPN configured'), icon: 'vpn_key_off'}));
    };

    wifiList.append(spinnerRow(_('Scanning...')));
    let busy = false;
    let again = false;
    page.refresh = () => {
        if (busy) {
            again = true;
            return;
        }
        busy = true;
        fire(fill().finally(() => {
            busy = false;
            if (again) {
                again = false;
                page.refresh();
            }
        }));
    };
    // Follow changes made elsewhere (Quick Settings, nmcli, other apps).
    fire(readRadio());
    watchDbus(Gio.BusType.SYSTEM, 'org.freedesktop.NetworkManager', () => {
        if (page.get_mapped())
            page.refresh();
        else
            fire(readRadio());
    });
    return page;
}
