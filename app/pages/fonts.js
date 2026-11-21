import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {_} from '../i18n.js';
import {gs} from '../sys.js';
import {gsFont, gsSelect, heading, iconButton, listCard, navigate, rowsFrom, sectionLabel, hbox, vbox} from '../ui.js';

const IFACE = 'org.gnome.desktop.interface';

/** Icon and cursor themes installed on this system (listed lazily). */
function themeNames(kind) {
    const dirs = ['/usr/share/icons', GLib.build_filenamev([GLib.get_user_data_dir(), 'icons']),
        GLib.build_filenamev([GLib.get_home_dir(), '.icons'])];
    const names = new Set();
    for (const dir of dirs) {
        try {
            const enumerator = Gio.File.new_for_path(dir).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                const base = GLib.build_filenamev([dir, info.get_name()]);
                const isCursor = GLib.file_test(GLib.build_filenamev([base, 'cursors']), GLib.FileTest.IS_DIR);
                const hasIndex = GLib.file_test(GLib.build_filenamev([base, 'index.theme']), GLib.FileTest.EXISTS);
                if (hasIndex && (kind === 'cursor' ? isCursor : !isCursor))
                    names.add(info.get_name());
            }
            enumerator.close(null);
        } catch {
            // Directory missing.
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

export function build() {
    const page = vbox(16);
    const top = hbox(8);
    top.append(iconButton('arrow_back', () => navigate('appearance'), _('Back')));
    top.append(heading(_('Fonts and themes'), _('Interface fonts, icon and cursor themes')));
    page.append(top);

    const iconTheme = gsSelect({schema: IFACE, key: 'icon-theme', title: _('Icon theme'), icon: 'interests', options: []});
    const cursorTheme = gsSelect({schema: IFACE, key: 'cursor-theme', title: _('Cursor theme'), icon: 'near_me', options: []});
    page.append(sectionLabel(_('Cursor')));
    page.append(listCard([
        ...rowsFrom([
            {t: 'select', schema: IFACE, key: 'cursor-size', title: _('Cursor size'), icon: 'mouse',
                options: [16, 20, 24, 32, 48].map(v => [v, `${v}`])},
        ]),
        cursorTheme,
    ].filter(Boolean)));
    page.append(sectionLabel(_('Icons')));
    page.append(listCard([iconTheme].filter(Boolean)));
    page.append(sectionLabel(_('Fonts')));
    page.append(listCard([
        gsFont({schema: IFACE, key: 'font-name', title: _('Interface font'), icon: 'text_fields'}),
        gsFont({schema: IFACE, key: 'document-font-name', title: _('Document font'), icon: 'description'}),
        gsFont({schema: IFACE, key: 'monospace-font-name', title: _('Monospace font'), icon: 'code'}),
    ].filter(Boolean)));

    // Theme folders are scanned after the page is on screen.
    page.refresh = () => {
        if (page._filled)
            return;
        page._filled = true;
        GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            for (const [line, kind] of [[iconTheme, 'icon'], [cursorTheme, 'cursor']]) {
                if (!line)
                    continue;
                const names = themeNames(kind);
                line.picker.setOptions(names.map(n => ({id: n, label: n})), gs.get(IFACE, kind === 'icon' ? 'icon-theme' : 'cursor-theme'));
            }
            return GLib.SOURCE_REMOVE;
        });
    };
    return page;
}
