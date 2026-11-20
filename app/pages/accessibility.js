import {_} from '../i18n.js';
import {heading, listCard, rowsFrom, sectionLabel, vbox} from '../ui.js';

const A11Y = 'org.gnome.desktop.a11y';
const APPS = 'org.gnome.desktop.a11y.applications';
const KB = 'org.gnome.desktop.a11y.keyboard';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Accessibility'), _('Seeing, hearing and typing aids')));

    page.append(sectionLabel(_('Seeing')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: 'org.gnome.desktop.a11y.interface', key: 'high-contrast', title: _('High contrast'),
            icon: 'contrast'},
        {t: 'switch', schema: 'org.gnome.desktop.interface', key: 'enable-animations', title: _('Animations'),
            icon: 'animation'},
        {t: 'switch', schema: APPS, key: 'screen-reader-enabled', title: _('Screen reader'), icon: 'record_voice_over'},
        {t: 'switch', schema: APPS, key: 'screen-magnifier-enabled', title: _('Zoom'), icon: 'search'},
        {t: 'select', schema: 'org.gnome.desktop.interface', key: 'cursor-size', title: _('Cursor size'),
            icon: 'near_me', options: [24, 32, 48, 64, 96].map(v => [v, `${v}`])},
        {t: 'select', schema: 'org.gnome.desktop.interface', key: 'overlay-scrolling', title: _('Overlay scroll bars'),
            icon: 'swap_vert', options: []},
    ].filter(s => s.key !== 'overlay-scrolling'))));

    page.append(sectionLabel(_('Typing')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: APPS, key: 'screen-keyboard-enabled', title: _('Screen keyboard'), icon: 'keyboard'},
        {t: 'switch', schema: KB, key: 'stickykeys-enable', title: _('Sticky keys'),
            sub: _('Press shortcut keys one at a time'), icon: 'keyboard_command_key'},
        {t: 'switch', schema: KB, key: 'slowkeys-enable', title: _('Slow keys'),
            sub: _('Delay before a key press is accepted'), icon: 'hourglass_empty'},
        {t: 'switch', schema: KB, key: 'bouncekeys-enable', title: _('Bounce keys'),
            sub: _('Ignore fast repeated key presses'), icon: 'ads_click'},
    ])));

    page.append(sectionLabel(_('Pointing and clicking')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: 'org.gnome.desktop.a11y.mouse', key: 'secondary-click-enabled',
            title: _('Simulated secondary click'), icon: 'mouse'},
        {t: 'switch', schema: 'org.gnome.desktop.a11y.mouse', key: 'dwell-click-enabled', title: _('Hover click'),
            icon: 'ads_click'},
        {t: 'switch', schema: A11Y, key: 'always-show-universal-access-status',
            title: _('Always show accessibility menu'), icon: 'accessibility_new'},
    ])));
    return page;
}
