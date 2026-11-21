import {_} from '../i18n.js';
import {gs} from '../sys.js';
import {
    card, gsSlider, heading, infoRows, listCard, navigate, pillButton, row, rowsFrom, sectionLabel, vbox,
} from '../ui.js';

const K = 'org.gnome.desktop.peripherals.keyboard';
const IS = 'org.gnome.desktop.input-sources';

export function build() {
    const page = vbox(16);
    page.append(heading(_('Keyboard'), _('Typing, layouts and shortcuts')));

    page.append(sectionLabel(_('Typing')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: K, key: 'repeat', title: _('Repeat keys'), icon: 'keyboard_return'},
    ])));
    const delay = gsSlider({
        schema: K, key: 'delay', title: _('Delay'), min: 100, max: 1000, step: 50, discrete: true, integer: true,
        leftIcon: 'timer', rightIcon: 'hourglass_bottom', format: v => `${Math.round(v)} ms`,
    });
    const interval = gsSlider({
        schema: K, key: 'repeat-interval', title: _('Repeat interval'), min: 10, max: 200, step: 10,
        discrete: true, integer: true, leftIcon: 'bolt', rightIcon: 'slow_motion_video',
        format: v => `${Math.round(v)} ms`,
    });
    if (delay || interval)
        page.append(card(delay, interval));

    page.append(sectionLabel(_('Input sources')));
    const sources = gs.get(IS, 'sources', []) ?? [];
    const names = sources.map(([kind, id]) => `${id}${kind === 'ibus' ? ' (IBus)' : ''}`);
    page.append(infoRows([[_('Layouts'), names.join(', ') || '-']]));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: IS, key: 'per-window', title: _('Different layout per window'), icon: 'window'},
    ])));

    page.append(listCard([row({
        title: _('Keyboard shortcuts'), sub: _('Change shortcuts for windows, apps and media'), icon: 'keyboard_command_key',
        trailing: pillButton(_('Open'), () => navigate('shortcuts'), {variant: 'tonal'}),
    })]));
    return page;
}
