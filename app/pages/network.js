import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {_} from '../i18n.js';
import {gs, hasCommand, run, splitTerse, watchDbus} from '../sys.js';
import {
    askText, clearBox, confirm, customSwitch, dialog, fire, getMainWindow, gsSelect, gsEntry, hbox, heading,
    iconButton, infoRows, listCard, note, pillButton, row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

const PROXY = 'org.gnome.system.proxy';

function bars(signal) {
    return signal > 50 ? 'wifi' : 'network_wifi';
}


/** `key:value` lines of `nmcli -t` as a Map (the value keeps any further colons). */
function parseKv(text) {
    const out = new Map();
    for (const line of text.split('\n')) {
        const i = line.indexOf(':');
        if (i > 0 && !out.has(line.slice(0, i).replace(/\[\d+\]$/, '')))
            out.set(line.slice(0, i).replace(/\[\d+\]$/, ''), line.slice(i + 1).replace(/\\:/g, ':'));
    }
    return out;
}

/** Host and port rows for one proxy protocol; they only show while the mode is manual. */
function proxyRow(schema, title, icon) {
    const settings = gs.settings(schema);
    if (!settings)
        return null;
    const host = new Gtk.Entry({text: settings.get_string('host'), width_chars: 16, placeholder_text: _('Host'),
        valign: Gtk.Align.CENTER});
    host.add_css_class('m3-entry');
    const port = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({lower: 0, upper: 65535, step_increment: 1, value: settings.get_int('port')}),
        valign: Gtk.Align.CENTER,
    });
    host.connect('changed', () => settings.set_string('host', host.text));
    port.connect('value-changed', () => settings.set_int('port', port.get_value_as_int()));
    const trailing = hbox(8);
    trailing.append(host);
    trailing.append(port);
    return row({title, icon, trailing});
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Wi-Fi & Network'), _('Wi-Fi, wired connections, VPN and proxy')));

    if (!hasCommand('nmcli')) {
        page.append(note(_('NetworkManager (nmcli) was not found on this system.'), 'wifi_off'));
        return page;
    }

    const wifiList = vbox(3, 'm3-card list');
    const wiredList = vbox(3, 'm3-card list');
    const vpnList = vbox(3, 'm3-card list');

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
    page.append(wifiList);
    page.append(sectionLabel(_('Wired')));
    page.append(wiredList);
    page.append(sectionLabel('VPN'));
    page.append(vpnList);

    page.append(sectionLabel(_('Proxy')));
    const urlRow = gsEntry({schema: PROXY, key: 'autoconfig-url', title: _('Configuration URL'), icon: 'link', width: 260});
    const manualRows = [
        proxyRow(`${PROXY}.http`, 'HTTP', 'http'),
        proxyRow(`${PROXY}.https`, 'HTTPS', 'https'),
        proxyRow(`${PROXY}.ftp`, 'FTP', 'folder_shared'),
        proxyRow(`${PROXY}.socks`, 'SOCKS', 'lan'),
    ].filter(Boolean);
    page.append(listCard([
        gsSelect({
            schema: PROXY, key: 'mode', title: _('Proxy'), icon: 'lan',
            options: [['none', _('Off')], ['manual', _('Manual')], ['auto', _('Automatic')]],
        }),
        urlRow,
        ...manualRows,
    ]));
    const proxySettings = gs.settings(PROXY);
    const syncProxy = () => {
        const mode = proxySettings?.get_string('mode') ?? 'none';
        urlRow.visible = mode === 'auto';
        manualRows.forEach(r => (r.visible = mode === 'manual'));
    };
    syncProxy();
    proxySettings?.connect('changed::mode', syncProxy);
    const hotspot = row({
        title: _('Hotspot'), sub: _('Share this connection over Wi-Fi'), icon: 'wifi_tethering',
    });
    const hotspotSlot = hbox(0);
    hotspot.append(hotspotSlot);
    const hidden = row({
        title: _('Hidden network'), sub: _('Connect to a network that does not show up'), icon: 'visibility_off',
        trailing: pillButton(_('Connect'), () => fire((async () => {
            const ssid = await askText({title: _('Hidden network'), message: _('Network name'), okLabel: _('Next')});
            if (!ssid?.trim())
                return;
            const password = await askText({title: ssid.trim(), message: _('Password (leave empty if open)'),
                password: true, okLabel: _('Connect')});
            if (password === null)
                return;
            const args = ['nmcli', '-w', '30', 'device', 'wifi', 'connect', ssid.trim(), 'hidden', 'yes'];
            if (password)
                args.push('password', password);
            const r = await run(args);
            toast(r.ok ? _('Connected to %s').format(ssid.trim()) : _('Could not connect'));
            page.refresh();
        })()), {variant: 'tonal'}),
    });
    const importVpn = row({
        title: _('Add VPN from file'), sub: _('OpenVPN (.ovpn) or WireGuard (.conf)'), icon: 'upload_file',
        trailing: pillButton(_('Import'), () => {
            const chooser = new Gtk.FileDialog({title: _('Choose a VPN file')});
            chooser.open(getMainWindow(), null, (_c, res) => {
                try {
                    const path = chooser.open_finish(res).get_path();
                    const type = path.endsWith('.ovpn') ? 'openvpn' : path.endsWith('.conf') ? 'wireguard' : null;
                    if (!type) {
                        toast(_('Unsupported file'));
                        return;
                    }
                    fire(run(['nmcli', 'connection', 'import', 'type', type, 'file', path]).then(r => {
                        toast(r.ok ? _('Settings updated') : _('Could not import'));
                        page.refresh();
                    }));
                } catch {
                    // Cancelled.
                }
            });
        }, {variant: 'tonal'}),
    });
    page.append(listCard([hidden, hotspot, importVpn]));
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

    const startHotspot = async () => {
        const name = await askText({title: _('Hotspot'), message: _('Network name'), initial: GLib.get_host_name(),
            okLabel: _('Next')});
        if (!name?.trim())
            return;
        const password = await askText({title: _('Hotspot'), message: _('Password (at least 8 characters)'),
            password: true, okLabel: _('Start')});
        if (!password || password.length < 8) {
            if (password !== null)
                toast(_('The password is too short'));
            return;
        }
        const r = await run(['nmcli', 'device', 'wifi', 'hotspot', 'ssid', name.trim(), 'password', password]);
        toast(r.ok ? _('Hotspot is on') : _('Could not start the hotspot'));
        page.refresh();
    };

    /** Facts and per-connection options of a saved or active connection. */
    const details = async (name, {device = '', saved = true, extra = []} = {}) => {
        const [conn, dev] = await Promise.all([
            saved ? run(['nmcli', '-t', '-f', 'connection.autoconnect,connection.metered,ipv4.method,ipv4.dns',
                'connection', 'show', 'id', name]) : null,
            device ? run(['nmcli', '-t', '-f', 'IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,GENERAL.HWADDR,CAPABILITIES.SPEED',
                'device', 'show', device]) : null,
        ]);
        const c = parseKv(conn?.stdout ?? '');
        const d = parseKv(dev?.stdout ?? '');
        const modify = (key, value) => fire(run(['nmcli', 'connection', 'modify', 'id', name, key, value])
            .then(r => toast(r.ok ? _('Settings updated') : _('Could not change'))));
        const content = vbox(10);
        content.append(infoRows([
            ...extra,
            d.get('IP4.ADDRESS') && [_('IP address'), d.get('IP4.ADDRESS')],
            d.get('IP4.GATEWAY') && [_('Gateway'), d.get('IP4.GATEWAY')],
            d.get('IP4.DNS') && [_('DNS'), d.get('IP4.DNS')],
            d.get('GENERAL.HWADDR') && [_('Hardware address'), d.get('GENERAL.HWADDR')],
            d.get('CAPABILITIES.SPEED') && d.get('CAPABILITIES.SPEED') !== 'unknown' &&
                [_('Link speed'), d.get('CAPABILITIES.SPEED')],
            c.get('ipv4.method') && [_('IPv4'), c.get('ipv4.method') === 'auto' ? _('Automatic') : c.get('ipv4.method')],
        ]));
        if (saved) {
            content.append(listCard([
                customSwitch({
                    title: _('Connect automatically'), icon: 'autorenew',
                    get: () => c.get('connection.autoconnect') !== 'no',
                    set: on => modify('connection.autoconnect', on ? 'yes' : 'no'),
                }),
                customSwitch({
                    title: _('Metered connection'), sub: _('Limits background data'), icon: 'data_usage',
                    get: () => (c.get('connection.metered') ?? '').startsWith('yes'),
                    set: on => modify('connection.metered', on ? 'yes' : 'no'),
                }),
            ]));
        }
        const buttons = [{id: 'close', label: _('Close')}];
        if (saved) {
            buttons.unshift({id: 'forget', label: _('Forget'), variant: 'danger'});
            buttons.unshift({id: 'dns', label: _('DNS')});
        }
        const answer = await dialog({title: name, content, buttons});
        if (answer === 'dns') {
            const current = (c.get('ipv4.dns') ?? '').replace(/,/g, ' ');
            const text = await askText({title: _('DNS servers'), message: _('Separated by spaces. Empty uses the automatic ones.'),
                initial: current});
            if (text !== null) {
                const servers = text.trim();
                await run(['nmcli', 'connection', 'modify', 'id', name, 'ipv4.dns', servers,
                    'ipv4.ignore-auto-dns', servers ? 'yes' : 'no']);
                if (device)
                    await run(['nmcli', 'connection', 'up', 'id', name]);
                toast();
            }
        } else if (answer === 'forget') {
            if (await confirm({title: _('Forget this network?'), message: name, okLabel: _('Forget'), danger: true})) {
                await run(['nmcli', 'connection', 'delete', 'id', name]);
                toast();
            }
        }
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

        const connRows = conns.stdout.split('\n').filter(Boolean).map(splitTerse);
        const saved = new Map(connRows.filter(([, type]) => type.includes('wireless')).map(([n, , dev]) => [n, dev]));
        const hotspotOn = connRows.some(([n, type, , act]) => n === 'Hotspot' && type.includes('wireless') && act === 'yes');
        hotspotSlot.get_first_child() && hotspotSlot.remove(hotspotSlot.get_first_child());
        hotspot.setSub(hotspotOn ? _('On') : _('Share this connection over Wi-Fi'));
        hotspotSlot.append(hotspotOn
            ? pillButton(_('Stop'), () => fire(run(['nmcli', 'connection', 'down', 'id', 'Hotspot']).then(() => page.refresh())))
            : pillButton(_('Start'), () => fire(startHotspot()), {variant: 'tonal'}));
        hotspotSlot.valign = Gtk.Align.CENTER;

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
            const trailing = hbox(6);
            trailing.append(active
                ? pillButton(_('Disconnect'), () => fire(
                    run(['nmcli', 'connection', 'down', 'id', ssid]).then(() => page.refresh())))
                : pillButton(_('Connect'), () => fire(connectWifi(ssid)), {variant: 'tonal'}));
            const open = () => fire(details(ssid, {
                device: active ? saved.get(ssid) ?? '' : '',
                saved: saved.has(ssid),
                extra: [[_('Signal'), `${signal}%`], [_('Security'), security && security !== '--' ? security : _('Open')]],
            }));
            trailing.append(iconButton('more_vert', open, _('Details')));
            wifiList.append(row({
                title: ssid,
                sub: [active ? _('Connected') : saved.has(ssid) ? _('Saved') : '',
                    security && security !== '--' ? security : _('Open')].filter(Boolean).join(' · '),
                icon: bars(Number(signal)),
                trailing,
                onClick: open,
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
            const trailing = hbox(6);
            trailing.append(pillButton(on ? _('Disconnect') : _('Connect'), () => fire(
                run(['nmcli', 'connection', on ? 'down' : 'up', 'id', name]).then(r => {
                    toast(r.ok ? _('Settings updated') : _('Could not connect'));
                    page.refresh();
                })), {variant: on ? '' : 'tonal'}));
            const open = () => fire(details(name, {device: on ? device : ''}));
            trailing.append(iconButton('more_vert', open, _('Details')));
            kind.append(row({
                title: name, sub: on ? `${_('Connected')}${device ? ` · ${device}` : ''}` : _('Not connected'),
                icon: kind === vpnList ? 'vpn_key' : 'settings_ethernet',
                trailing,
                onClick: open,
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
