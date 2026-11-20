import {_} from '../i18n.js';
import {heading, listCard, rowsFrom, sectionLabel, vbox} from '../ui.js';

const P = 'org.gnome.desktop.privacy';
const SS = 'org.gnome.desktop.screensaver';

const delay = [[0, _('Never')], [60, _('1 minute')], [180, _('3 minutes')], [300, _('5 minutes')],
    [600, _('10 minutes')], [900, _('15 minutes')], [1800, _('30 minutes')]];

export function build() {
    const page = vbox(16);
    page.append(heading(_('Privacy & Security'), _('Screen lock, location and file history')));

    page.append(sectionLabel(_('Screen lock')));
    page.append(listCard(rowsFrom([
        {t: 'select', schema: 'org.gnome.desktop.session', key: 'idle-delay', title: _('Blank screen delay'),
            icon: 'timer', options: delay},
        {t: 'switch', schema: SS, key: 'lock-enabled', title: _('Automatic screen lock'), icon: 'lock_clock'},
        {t: 'select', schema: SS, key: 'lock-delay', title: _('Lock delay after blank'), icon: 'hourglass_top',
            options: [[0, _('Immediately')], [30, _('30 seconds')], [60, _('1 minute')], [180, _('3 minutes')],
                [600, _('10 minutes')]]},
    ])));

    page.append(sectionLabel(_('Devices and location')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: 'org.gnome.system.location', key: 'enabled', title: _('Location services'),
            icon: 'location_on'},
        {t: 'switch', schema: P, key: 'disable-camera', title: _('Disable camera'), icon: 'videocam_off'},
        {t: 'switch', schema: P, key: 'disable-microphone', title: _('Disable microphone'), icon: 'mic_off'},
        {t: 'switch', schema: P, key: 'usb-protection', title: _('USB protection'),
            sub: _('Block new USB devices while the screen is locked'), icon: 'usb_off'},
    ])));

    page.append(sectionLabel(_('History')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: P, key: 'remember-recent-files', title: _('File history'), icon: 'history'},
        {t: 'select', schema: P, key: 'recent-files-max-age', title: _('Keep history for'), icon: 'event',
            options: [[1, _('1 day')], [7, _('7 days')], [30, _('30 days')], [-1, _('Forever')]]},
        {t: 'switch', schema: P, key: 'remove-old-trash-files', title: _('Automatically empty trash'), icon: 'delete'},
        {t: 'switch', schema: P, key: 'remove-old-temp-files', title: _('Automatically delete temporary files'),
            icon: 'cleaning_services'},
        {t: 'select', schema: P, key: 'old-files-age', title: _('Delete files older than'), icon: 'schedule',
            options: [[0, '0'], [1, _('1 day')], [7, _('7 days')], [30, _('30 days')]]},
        {t: 'switch', schema: P, key: 'report-technical-problems', title: _('Send problem reports'),
            icon: 'bug_report'},
    ])));
    return page;
}
