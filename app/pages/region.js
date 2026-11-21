import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {_} from '../i18n.js';
import {dbusCall, dbusProxy, gs, run} from '../sys.js';
import {fire, heading, infoRows, listCard, selectRow, sectionLabel, toast, vbox} from '../ui.js';

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
    const accountUser = async () => {
        const accounts = await dbusProxy(Gio.BusType.SYSTEM, 'org.freedesktop.Accounts',
            '/org/freedesktop/Accounts', 'org.freedesktop.Accounts');
        const found = accounts && await dbusCall(accounts, 'FindUserByName', new GLib.Variant('(s)', [GLib.get_user_name()]));
        const path = found?.deepUnpack()[0];
        return path ? dbusProxy(Gio.BusType.SYSTEM, 'org.freedesktop.Accounts', path, 'org.freedesktop.Accounts.User') : null;
    };
    const language = selectRow({
        title: _('Display language'), sub: _('Applies after you log in again'), icon: 'language', search: true, options: [],
        get: () => (GLib.getenv('LANG') ?? '').replace(/\.utf-?8$/i, '.UTF-8'),
        set: id => fire(accountUser().then(async user => {
            const ok = user && await dbusCall(user, 'SetLanguage', new GLib.Variant('(s)', [id]));
            toast(ok ? _('Log out and in to apply the language') : _('Could not change the language'));
        })),
    });
    page.append(sectionLabel(_('Language')));
    page.append(listCard([language]));
    const previousRefresh = page.refresh;
    page.refresh = () => {
        previousRefresh?.();
        if (page._langLoaded)
            return;
        page._langLoaded = true;
        fire(run(['locale', '-a']).then(r => {
            const list = [...new Set(r.stdout.split('\n').filter(l => l.includes('.') && /utf-?8/i.test(l))
                .map(l => l.replace(/utf8$/i, 'UTF-8')))].sort();
            language.picker.setOptions(list.map(id => ({id, label: id})), (GLib.getenv('LANG') ?? '').replace(/\.utf-?8$/i, '.UTF-8'));
        }));
    };
    return page;
}
