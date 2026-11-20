import {_} from '../i18n.js';
import {heading, listCard, rowsFrom, vbox} from '../ui.js';

const S = 'org.gnome.desktop.search-providers';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Search'), _('Search results in the app overview')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: S, key: 'disable-external', title: _('Search from other apps'),
            sub: _('Allow apps to add results to the overview search'), icon: 'search', invert: true},
    ])));
    return page;
}
