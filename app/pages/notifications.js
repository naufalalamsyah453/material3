import {_} from '../i18n.js';
import {heading, listCard, rowsFrom, vbox} from '../ui.js';

const N = 'org.gnome.desktop.notifications';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Notifications'), _('Banners and lock screen')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: N, key: 'show-banners', title: _('Notification banners'),
            sub: _('Turn off for Do Not Disturb'), icon: 'notifications_paused'},
        {t: 'switch', schema: N, key: 'show-in-lock-screen', title: _('Lock screen notifications'),
            sub: _('Show notifications while the screen is locked'), icon: 'lock'},
    ])));
    return page;
}
