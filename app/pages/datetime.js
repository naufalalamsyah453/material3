import {_} from '../i18n.js';
import {fire, heading, listCard, rowsFrom, sectionLabel, selectRow, customSwitch, toast, vbox} from '../ui.js';
import {hasCommand, run} from '../sys.js';

const I = 'org.gnome.desktop.interface';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Date & Time'), _('Clock, time zone and automatic time')));

    const rows = [];
    if (hasCommand('timedatectl')) {
        const ntp = customSwitch({
            title: _('Automatic date and time'), sub: _('Sync the clock over the network'), icon: 'sync',
            get: () => false,
            set: on => fire(run(['timedatectl', 'set-ntp', on ? 'true' : 'false']).then(r => {
                if (!r.ok)
                    toast(_('Could not change the setting'));
            })),
        });
        const zone = selectRow({
            title: _('Time zone'), icon: 'public', search: true, options: [], get: () => null,
            set: id => fire(run(['timedatectl', 'set-timezone', id]).then(r => {
                if (!r.ok)
                    toast(_('Could not change the setting'));
            })),
        });
        rows.push(ntp, zone);
        page.refresh = () => {
            if (page._loaded)
                return;
            page._loaded = true;
            fire(Promise.all([
                run(['timedatectl', 'show', '--property=NTP', '--property=Timezone']),
                run(['timedatectl', 'list-timezones']),
            ]).then(([show, zones]) => {
                const props = Object.fromEntries(show.stdout.split('\n').filter(Boolean).map(l => l.split('=')));
                ntp.setActive(props.NTP === 'yes');
                zone.picker.setOptions(zones.stdout.split('\n').filter(Boolean).map(z => ({id: z, label: z})),
                    props.Timezone);
            }));
        };
    }
    page.append(listCard(rows));

    page.append(sectionLabel(_('Clock')));
    page.append(listCard(rowsFrom([
        {t: 'select', schema: I, key: 'clock-format', title: _('Time format'), icon: 'schedule',
            options: [['24h', _('24-hour')], ['12h', _('AM/PM')]]},
        {t: 'switch', schema: I, key: 'clock-show-seconds', title: _('Show seconds'), icon: 'timer'},
        {t: 'switch', schema: I, key: 'clock-show-weekday', title: _('Show weekday'), icon: 'today'},
        {t: 'switch', schema: I, key: 'clock-show-date', title: _('Show date'), icon: 'calendar_today'},
        {t: 'switch', schema: 'org.gnome.desktop.calendar', key: 'show-weekdate', title: _('Show week numbers'),
            icon: 'view_week'},
    ])));
    return page;
}
