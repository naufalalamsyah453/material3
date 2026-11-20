import GLib from 'gi://GLib';

import {_} from '../i18n.js';
import {gs, hasCommand, run} from '../sys.js';
import {fire, heading, infoRows, listCard, pillButton, row, selectRow, sectionLabel, vbox} from '../ui.js';

const L = 'org.gnome.system.locale';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Region & Language'), _('Formats and display language')));
    const lang = GLib.getenv('LANG') ?? GLib.getenv('LC_ALL') ?? '-';
    page.append(infoRows([[_('Language'), lang], [_('Formats'), gs.get(L, 'region', '') || lang]]));

    const formats = selectRow({
        title: _('Formats'), sub: _('Dates, numbers and currency'), icon: 'public', search: true, options: [],
        get: () => gs.get(L, 'region', ''),
        set: id => gs.set(L, 'region', id),
    });
    if (gs.has(L, 'region')) {
        page.append(sectionLabel(_('Formats')));
        page.append(listCard([formats]));
    }
    page.refresh = () => {
        if (page._loaded || !gs.has(L, 'region'))
            return;
        page._loaded = true;
        fire(run(['locale', '-a']).then(r => {
            const list = r.stdout.split('\n').filter(l => l.includes('.') && /utf-?8/i.test(l))
                .map(l => l.replace(/utf8$/i, 'UTF-8'));
            const unique = [...new Set(['', ...list])].sort();
            formats.picker.setOptions(unique.map(id => ({id, label: id || _('Same as language')})),
                gs.get(L, 'region', ''));
        }));
    };
    if (hasCommand('gnome-control-center')) {
        page.append(listCard([row({
            title: _('Display language'), sub: _('Changing the system language needs administrator rights'),
            icon: 'language',
            trailing: pillButton(_('Open'), () => run(['gnome-control-center', 'system']), {variant: 'tonal'}),
        })]));
    }
    return page;
}
