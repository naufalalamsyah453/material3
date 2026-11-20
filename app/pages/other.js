import {_} from '../i18n.js';
import {hasCommand, run} from '../sys.js';
import {heading, listCard, note, pillButton, row, vbox} from '../ui.js';

const PANELS = [
    ['online-accounts', 'cloud', _('Online Accounts'), _('Connect cloud and calendar accounts')],
    ['printers', 'print', _('Printers'), _('Add and manage printers')],
    ['users', 'group', _('Users'), _('Accounts, password and login')],
    ['color', 'palette', _('Color'), _('Display color profiles')],
    ['wacom', 'draw', _('Drawing Tablets'), _('Tablet and stylus settings')],
    ['thunderbolt', 'bolt', _('Thunderbolt'), _('Thunderbolt devices')],
    ['system', 'settings_suggest', _('System'), _('Remote login, users and admin')],
];

export function build() {
    const page = vbox(16);
    page.append(heading(_('More Settings'), _('Panels opened with the GNOME Settings app')));
    if (!hasCommand('gnome-control-center')) {
        page.append(note(_('gnome-control-center is not installed, so these panels are unavailable.'), 'info'));
        return page;
    }
    page.append(listCard(PANELS.map(([id, icon, title, sub]) => row({
        title, sub, icon,
        trailing: pillButton(_('Open'), () => run(['gnome-control-center', id]), {variant: 'tonal'}),
    }))));
    return page;
}
