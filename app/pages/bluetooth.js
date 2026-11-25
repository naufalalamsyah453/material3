import Gio from 'gi://Gio';

import {_} from '../i18n.js';
import {hasCommand, run, watchDbus} from '../sys.js';
import {
    askText, clearBox, confirm, customSwitch, dialog, fire, hbox, heading, iconButton, infoRows, listCard, note, pillButton,
    row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

const TYPE_ICONS = {
    'audio-headset': 'headphones', 'audio-headphones': 'headphones', 'audio-card': 'speaker',
    'input-keyboard': 'keyboard', 'input-mouse': 'mouse', 'input-gaming': 'sports_esports',
    'input-tablet': 'tablet', phone: 'smartphone', computer: 'computer', 'camera-photo': 'photo_camera',
    'camera-video': 'photo_camera', 'printer': 'print', 'video-display': 'tv',
};

/** Fields of `bluetoothctl info` as an object. */
function parseInfo(text) {
    const out = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s+([A-Za-z ]+):\s*(.*)$/);
        if (m && !(m[1] in out))
            out[m[1]] = m[2];
    }
    const battery = (out['Battery Percentage'] ?? '').match(/\((\d+)\)/);
    return {
        alias: out.Alias ?? out.Name ?? '',
        icon: TYPE_ICONS[out.Icon] ?? 'devices',
        type: out.Icon ?? '',
        paired: out.Paired === 'yes',
        trusted: out.Trusted === 'yes',
        connected: out.Connected === 'yes',
        battery: battery ? Number(battery[1]) : null,
    };
}

const devicePath = mac => `/org/bluez/hci0/dev_${mac.replace(/:/g, '_')}`;

const parseDevices = text => text.split('\n').filter(Boolean).map(line => {
    const m = line.match(/^Device\s+([0-9A-F:]{17})\s+(.*)$/i);
    return m ? {mac: m[1], name: m[2]} : null;
}).filter(Boolean);

export function build() {
    const page = vbox(16);
    page.append(heading(_('Bluetooth'), _('Pair and manage wireless devices')));
    if (!hasCommand('bluetoothctl')) {
        page.append(note(_('bluetoothctl was not found on this system.'), 'bluetooth_disabled'));
        return page;
    }
    const power = customSwitch({
        title: _('Bluetooth'), icon: 'bluetooth', get: () => false,
        set: on => fire((async () => {
            // A soft block (airplane mode) makes `power on` fail silently.
            if (on)
                await run(['rfkill', 'unblock', 'bluetooth']);
            const r = await run(['bluetoothctl', 'power', on ? 'on' : 'off'], {timeout: 10});
            if (!r.ok) {
                toast(_('Could not change'));
                power.settle(!on);
            }
            page.refresh();
        })()),
    });
    const nameRow = row({
        title: _('Device name'), sub: '', icon: 'badge',
        trailing: iconButton('edit', async () => {
            const name = await askText({title: _('Device name'), message: _('How this computer appears to other devices'),
                initial: nameRow.current ?? ''});
            if (name === null || !name.trim())
                return;
            await run(['bluetoothctl', 'system-alias', name.trim()]);
            toast();
            page.refresh();
        }, _('Rename')),
    });
    const visible = customSwitch({
        title: _('Visible'), sub: _('Other devices can find this computer'), icon: 'visibility', get: () => false,
        set: on => fire(run(['bluetoothctl', 'discoverable', on ? 'on' : 'off']).then(() => page.refresh())),
    });
    page.append(listCard([power, nameRow, visible]));

    page.append(sectionLabel(_('My devices')));
    const mineList = vbox(3, 'm3-card list');
    page.append(mineList);

    page.append(sectionLabel(_('Nearby devices')));
    const nearList = vbox(3, 'm3-card list');
    page.append(nearList);
    page.append(listCard([row({
        title: _('Scan for devices'), sub: _('Scans for ten seconds'), icon: 'bluetooth_searching',
        trailing: pillButton(_('Scan'), () => {
            fire(run(['bluetoothctl', '--timeout', '10', 'scan', 'on']).then(() => page.refresh()));
            toast(_('Scanning...'));
        }, {variant: 'tonal'}),
    })]));

    const act = (args, ok) => fire(run(['bluetoothctl', ...args], {timeout: 25}).then(r => {
        toast(r.ok ? ok : _('Could not connect'));
        page.refresh();
    }));

    const readPower = async () => {
        const show = await run(['bluetoothctl', 'show']);
        power.setActive(/Powered:\s+yes/.test(show.stdout));
        visible.setActive(/Discoverable:\s+yes/.test(show.stdout));
        nameRow.current = show.stdout.match(/Alias:\s*(.+)/)?.[1]?.trim() ?? '';
        nameRow.setSub(nameRow.current);
    };

    const details = async (d, info) => {
        const buttons = [{id: 'close', label: _('Close')}];
        if (hasCommand('bluetooth-sendto') && info.connected)
            buttons.unshift({id: 'send', label: _('Send files')});
        buttons.unshift({id: 'forget', label: _('Forget'), variant: 'danger'});
        buttons.unshift({id: 'trust', label: info.trusted ? _('Untrust') : _('Trust')});
        buttons.unshift({id: 'rename', label: _('Rename')});
        const answer = await dialog({
            title: info.alias || d.name,
            content: infoRows([
                [_('Address'), d.mac],
                info.type && [_('Type'), info.type],
                [_('Status'), info.connected ? _('Connected') : _('Not connected')],
                info.battery !== null && [_('Battery'), `${info.battery}%`],
                [_('Trusted'), info.trusted ? _('Yes') : _('No')],
            ]),
            buttons,
        });
        if (answer === 'rename') {
            const name = await askText({title: _('Rename'), initial: info.alias || d.name});
            if (name?.trim()) {
                await run(['busctl', '--system', 'set-property', 'org.bluez', devicePath(d.mac),
                    'org.bluez.Device1', 'Alias', 's', name.trim()]);
                toast();
            }
        } else if (answer === 'trust') {
            await run(['bluetoothctl', info.trusted ? 'untrust' : 'trust', d.mac]);
            toast();
        } else if (answer === 'forget') {
            if (await confirm({title: _('Forget this device?'), message: info.alias || d.name,
                okLabel: _('Forget'), danger: true})) {
                await run(['bluetoothctl', 'remove', d.mac]);
                toast();
            }
        } else if (answer === 'send') {
            run(['bluetooth-sendto', `--device=${d.mac}`]);
        }
        page.refresh();
    };

    const fill = async () => {
        const powered = readPower();
        const [paired, all, connected] = await Promise.all([
            run(['bluetoothctl', 'devices', 'Paired']),
            run(['bluetoothctl', 'devices']),
            run(['bluetoothctl', 'devices', 'Connected']),
        ]);
        await powered;
        const pairedList = parseDevices(paired.stdout);
        const infos = new Map();
        await Promise.all(pairedList.map(async d => {
            infos.set(d.mac, parseInfo((await run(['bluetoothctl', 'info', d.mac])).stdout));
        }));
        const live = new Set(parseDevices(connected.stdout).map(d => d.mac));
        const pairedMacs = new Set(pairedList.map(d => d.mac));

        clearBox(mineList);
        for (const d of pairedList) {
            const on = live.has(d.mac);
            const info = infos.get(d.mac) ?? parseInfo('');
            const state = on ? _('Connected') : _('Not connected');
            const trailing = hbox(6);
            trailing.append(pillButton(on ? _('Disconnect') : _('Connect'),
                () => act([on ? 'disconnect' : 'connect', d.mac], _('Settings updated')),
                {variant: on ? '' : 'tonal'}));
            trailing.append(iconButton('more_vert', () => fire(details(d, info)), _('Details')));
            mineList.append(row({
                title: info.alias || d.name,
                sub: info.battery !== null ? `${state} · ${info.battery}%` : state,
                icon: info.icon,
                trailing,
                onClick: () => fire(details(d, info)),
            }));
        }
        if (!pairedList.length)
            mineList.append(row({title: _('No paired devices'), icon: 'bluetooth_disabled'}));

        clearBox(nearList);
        const others = parseDevices(all.stdout).filter(d => !pairedMacs.has(d.mac) && !/^[0-9A-F]{2}([-:][0-9A-F]{2}){5}$/i.test(d.name));
        for (const d of others.slice(0, 15)) {
            nearList.append(row({
                title: d.name, sub: d.mac, icon: 'devices_other',
                trailing: pillButton(_('Pair'), () => act(['pair', d.mac], _('Settings updated')), {variant: 'tonal'}),
            }));
        }
        if (!others.length)
            nearList.append(row({title: _('No nearby devices'), icon: 'bluetooth_searching'}));
    };
    mineList.append(spinnerRow(_('Loading...')));
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
    // Follow changes made elsewhere (Quick Settings, other apps).
    fire(readPower());
    watchDbus(Gio.BusType.SYSTEM, 'org.bluez', () => {
        if (page.get_mapped())
            page.refresh();
        else
            fire(readPower());
    });
    return page;
}
