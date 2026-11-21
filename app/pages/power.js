import Gio from 'gi://Gio';

import {_} from '../i18n.js';
import {hasCommand, readFile, run, watchDbus} from '../sys.js';
import {fire, heading, listCard, rowsFrom, sectionLabel, selectRow, vbox, infoRows} from '../ui.js';

const P = 'org.gnome.settings-daemon.plugins.power';
const idle = [[0, _('Never')], [300, _('5 minutes')], [600, _('10 minutes')], [900, _('15 minutes')],
    [1800, _('30 minutes')], [3600, _('1 hour')]];
const action = [['suspend', _('Suspend')], ['hibernate', _('Hibernate')], ['nothing', _('Do nothing')]];

function battery() {
    for (let i = 0; i < 4; i++) {
        const base = `/sys/class/power_supply/BAT${i}`;
        const cap = readFile(`${base}/capacity`);
        if (cap)
            return [_('Battery'), `${cap.trim()}% · ${(readFile(`${base}/status`) ?? '').trim()}`];
    }
    return null;
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Power'), _('Power mode, battery and suspend')));

    const info = battery();
    if (info)
        page.append(infoRows([info]));

    if (hasCommand('powerprofilesctl')) {
        const modes = [['power-saver', _('Power Saver')], ['balanced', _('Balanced')], ['performance', _('Performance')]];
        const line = selectRow({
            title: _('Power mode'), icon: 'bolt', options: modes.map(([id, text]) => ({id, label: text})),
            get: () => 'balanced',
            set: id => run(['powerprofilesctl', 'set', id]),
        });
        const readMode = () => fire(run(['powerprofilesctl', 'get']).then(r => line.picker.select(r.stdout.trim())));
        readMode();
        watchDbus(Gio.BusType.SYSTEM, 'org.freedesktop.UPower.PowerProfiles', readMode);
        page.append(listCard([line]));
    }

    page.append(sectionLabel(_('Suspend and power button')));
    page.append(listCard(rowsFrom([
        {t: 'select', schema: P, key: 'sleep-inactive-ac-timeout', title: _('Suspend when on AC power'),
            icon: 'power', options: idle},
        {t: 'select', schema: P, key: 'sleep-inactive-battery-timeout', title: _('Suspend on battery'),
            icon: 'battery_android_full', options: idle},
        {t: 'select', schema: P, key: 'power-button-action', title: _('Power button'), icon: 'power_settings_new',
            options: [...action, ['interactive', _('Ask')]]},
        {t: 'switch', schema: 'org.gnome.desktop.interface', key: 'show-battery-percentage',
            title: _('Show battery percentage'), icon: 'battery_full'},
        {t: 'switch', schema: P, key: 'idle-dim', title: _('Dim screen when inactive'), icon: 'brightness_medium'},
    ])));
    return page;
}
