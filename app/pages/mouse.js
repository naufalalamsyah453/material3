import {_} from '../i18n.js';
import {gs} from '../sys.js';
import {card, gsSlider, heading, listCard, rowsFrom, sectionLabel, vbox} from '../ui.js';

const M = 'org.gnome.desktop.peripherals.mouse';
const T = 'org.gnome.desktop.peripherals.touchpad';

const speed = schema => gsSlider({
    schema, key: 'speed', title: _('Pointer speed'), min: -1, max: 1, step: 0.1, discrete: true,
    leftIcon: 'slow_motion_video', rightIcon: 'speed', format: v => v.toFixed(1),
});

export function build() {
    const page = vbox(16);
    page.append(heading(_('Mouse & Touchpad'), _('Pointer speed, scrolling and clicking')));

    page.append(sectionLabel(_('Mouse')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: M, key: 'left-handed', title: _('Primary button on the right'), icon: 'compare_arrows'},
        {t: 'switch', schema: M, key: 'natural-scroll', title: _('Natural scrolling'), icon: 'swipe_vertical'},
        {t: 'select', schema: M, key: 'accel-profile', title: _('Acceleration'), icon: 'moving',
            options: [['default', _('Default')], ['flat', _('Flat')], ['adaptive', _('Adaptive')]]},
    ])));
    if (gs.has(M, 'speed'))
        page.append(card(speed(M)));

    page.append(sectionLabel(_('Touchpad')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: T, key: 'tap-to-click', title: _('Tap to click'), icon: 'touch_app'},
        {t: 'switch', schema: T, key: 'natural-scroll', title: _('Natural scrolling'), icon: 'swipe_vertical'},
        {t: 'switch', schema: T, key: 'two-finger-scrolling-enabled', title: _('Two-finger scrolling'),
            icon: 'swipe'},
        {t: 'switch', schema: T, key: 'disable-while-typing', title: _('Disable while typing'), icon: 'keyboard'},
        {t: 'select', schema: T, key: 'click-method', title: _('Click method'), icon: 'ads_click',
            options: [['default', _('Default')], ['areas', _('Areas')], ['fingers', _('Fingers')]]},
        {t: 'select', schema: T, key: 'send-events', title: _('Touchpad'), icon: 'touchpad_mouse',
            options: [['enabled', _('Enabled')], ['disabled', _('Disabled')],
                ['disabled-on-external-mouse', _('Disabled when a mouse is connected')]]},
    ])));
    if (gs.has(T, 'speed'))
        page.append(card(speed(T)));
    return page;
}
