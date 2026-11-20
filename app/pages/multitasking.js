import {_} from '../i18n.js';
import {gs} from '../sys.js';
import {heading, listCard, rowsFrom, sectionLabel, vbox} from '../ui.js';

const M = 'org.gnome.mutter';
const WM = 'org.gnome.desktop.wm.preferences';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Multitasking'), _('Hot corner, window tiling and workspaces')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: 'org.gnome.desktop.interface', key: 'enable-hot-corners',
            title: _('Hot corner'), sub: _('Open the overview by moving the pointer to the top-left corner'), icon: 'north_west'},
        {t: 'switch', schema: M, key: 'edge-tiling', title: _('Active screen edges'),
            sub: _('Drag windows to the screen edges to tile them'), icon: 'splitscreen'},
    ])));
    page.append(sectionLabel(_('Workspaces')));
    const fixed = gs.get(M, 'dynamic-workspaces', true) === false;
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: M, key: 'dynamic-workspaces', title: _('Dynamic workspaces'),
            sub: _('Automatically remove empty workspaces'), icon: 'dashboard'},
        fixed || !gs.has(M, 'dynamic-workspaces') ? {t: 'select', schema: WM, key: 'num-workspaces',
            title: _('Number of workspaces'), icon: 'grid_view',
            options: [1, 2, 3, 4, 6, 8, 10].map(v => [v, `${v}`])} : null,
        {t: 'switch', schema: M, key: 'workspaces-only-on-primary', title: _('Workspaces on primary display only'),
            icon: 'desktop_windows'},
    ])));
    page.append(sectionLabel(_('App switching')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: 'org.gnome.shell.app-switcher', key: 'current-workspace-only',
            title: _('Include apps from the current workspace only'), icon: 'switch_access_shortcut'},
    ])));
    return page;
}
