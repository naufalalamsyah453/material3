import Gio from 'gi://Gio';

import {_} from '../i18n.js';
import {hasCommand, run, watchDbus} from '../sys.js';
import {
    clearBox, customSwitch, fire, heading, listCard, note, pillButton, row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

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
        set: on => fire(run(['bluetoothctl', 'power', on ? 'on' : 'off']).then(() => page.refresh())),
    });
    page.append(listCard([power]));

    page.append(sectionLabel(_('My devices')));
    const mine = vbox(0, 'm3-card list');
    const mineList = vbox(0);
    mine.append(mineList);
    page.append(mine);

    page.append(sectionLabel(_('Nearby devices')));
    const nearby = vbox(0, 'm3-card list');
    const nearList = vbox(0);
    nearby.append(nearList);
    page.append(nearby);
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
        const live = new Set(parseDevices(connected.stdout).map(d => d.mac));
        const pairedMacs = new Set(pairedList.map(d => d.mac));

        clearBox(mineList);
        for (const d of pairedList) {
            const on = live.has(d.mac);
            mineList.append(row({
                title: d.name, sub: on ? _('Connected') : _('Not connected'), icon: 'devices',
                trailing: pillButton(on ? _('Disconnect') : _('Connect'),
                    () => act([on ? 'disconnect' : 'connect', d.mac], _('Settings updated')),
                    {variant: on ? '' : 'tonal'}),
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
