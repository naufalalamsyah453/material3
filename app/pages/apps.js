import Gio from 'gi://Gio';

import {_} from '../i18n.js';
import {heading, listCard, rowsFrom, sectionLabel, selectRow, vbox} from '../ui.js';

const MEDIA = 'org.gnome.desktop.media-handling';

const KINDS = [
    {title: _('Web'), icon: 'language', mime: 'x-scheme-handler/https', filter: 'text/html'},
    {title: _('Mail'), icon: 'mail', mime: 'x-scheme-handler/mailto', filter: 'x-scheme-handler/mailto'},
    {title: _('Calendar'), icon: 'calendar_month', mime: 'text/calendar', filter: 'text/calendar'},
    {title: _('Music'), icon: 'music_note', mime: 'audio/mpeg', filter: 'audio/mpeg'},
    {title: _('Video'), icon: 'movie', mime: 'video/mp4', filter: 'video/mp4'},
    {title: _('Photos'), icon: 'image', mime: 'image/jpeg', filter: 'image/jpeg'},
    {title: _('Documents'), icon: 'description', mime: 'application/pdf', filter: 'application/pdf'},
];

export function build() {
    const page = vbox(16);
    page.append(heading(_('Apps'), _('Default applications and removable media')));
    page.append(sectionLabel(_('Default apps')));
    const rows = [];
    for (const kind of KINDS) {
        const apps = Gio.AppInfo.get_recommended_for_type(kind.filter)
            .filter(a => a.should_show() && a.get_id());
        if (apps.length === 0)
            continue;
        const current = Gio.AppInfo.get_default_for_type(kind.mime, false)?.get_id() ?? null;
        rows.push(selectRow({
            title: kind.title, icon: kind.icon,
            options: apps.map(a => ({id: a.get_id(), label: a.get_name()})),
            get: () => current,
            set: id => {
                const app = apps.find(a => a.get_id() === id);
                try {
                    app?.set_as_default_for_type(kind.mime);
                    if (kind.mime === 'x-scheme-handler/https')
                        app?.set_as_default_for_type('x-scheme-handler/http');
                } catch (e) {
                    console.error(`material3: ${e.message}`);
                }
            },
        }));
    }
    page.append(listCard(rows));

    page.append(sectionLabel(_('Removable media')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: MEDIA, key: 'automount', title: _('Mount removable media automatically'), icon: 'usb'},
        {t: 'switch', schema: MEDIA, key: 'automount-open', title: _('Open folder for new media'), icon: 'folder_open'},
        {t: 'switch', schema: MEDIA, key: 'autorun-never', title: _('Never prompt or start programs on media insertion'),
            icon: 'block'},
    ])));
    return page;
}
