import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import {_} from '../i18n.js';
import {gs} from '../sys.js';
import {clearBox, dialog, heading, label, listCard, pillButton, row, sectionLabel, toast, vbox} from '../ui.js';

const WM = 'org.gnome.desktop.wm.keybindings';
const SHELL = 'org.gnome.shell.keybindings';
const MEDIA = 'org.gnome.settings-daemon.plugins.media-keys';

const GROUPS = () => [
    [_('Windows'), [
        [WM, 'close', _('Close window'), 'close'],
        [WM, 'minimize', _('Minimize window'), 'remove'],
        [WM, 'toggle-maximized', _('Maximize window'), 'fullscreen'],
        [WM, 'toggle-fullscreen', _('Full screen'), 'fullscreen_exit'],
        [WM, 'show-desktop', _('Show desktop'), 'desktop_windows'],
    ]],
    [_('Navigation'), [
        [SHELL, 'toggle-overview', _('Overview'), 'dashboard'],
        [SHELL, 'toggle-application-view', _('App grid'), 'apps'],
        [WM, 'switch-applications', _('Switch apps'), 'compare_arrows'],
        [WM, 'switch-windows', _('Switch windows'), 'select_window'],
        [WM, 'switch-to-workspace-left', _('Workspace left'), 'arrow_back'],
        [WM, 'switch-to-workspace-right', _('Workspace right'), 'arrow_forward'],
        [WM, 'move-to-workspace-left', _('Move window left'), 'west'],
        [WM, 'move-to-workspace-right', _('Move window right'), 'east'],
    ]],
    [_('System'), [
        [SHELL, 'toggle-message-tray', _('Notifications'), 'notifications'],
        [SHELL, 'toggle-quick-settings', _('Quick Settings'), 'toggle_on'],
        [SHELL, 'show-screenshot-ui', _('Screenshot'), 'screenshot'],
        [MEDIA, 'screensaver', _('Lock screen'), 'lock'],
        [MEDIA, 'logout', _('Log out'), 'logout'],
        [MEDIA, 'help', _('Help'), 'help'],
    ]],
    [_('Launchers'), [
        [MEDIA, 'terminal', _('Terminal'), 'terminal'],
        [MEDIA, 'www', _('Web browser'), 'language'],
        [MEDIA, 'home', _('Home folder'), 'home'],
        [MEDIA, 'email', _('Email'), 'mail'],
        [MEDIA, 'calculator', _('Calculator'), 'calculate'],
        [MEDIA, 'search', _('Search'), 'search'],
    ]],
    [_('Media'), [
        [MEDIA, 'volume-up', _('Volume up'), 'volume_up'],
        [MEDIA, 'volume-down', _('Volume down'), 'volume_down'],
        [MEDIA, 'volume-mute', _('Mute'), 'volume_off'],
        [MEDIA, 'play', _('Play / pause'), 'play_arrow'],
        [MEDIA, 'next', _('Next track'), 'skip_next'],
        [MEDIA, 'previous', _('Previous track'), 'skip_previous'],
    ]],
];

const accelLabel = accels => accels.length
    ? accels.map(a => Gtk.accelerator_get_label(...Gtk.accelerator_parse(a).slice(1))).join(', ')
    : _('Disabled');

/** Ask for a key combination; resolves with an accelerator string, '' (clear) or null (cancel). */
async function captureAccel(title) {
    let result = null;
    const hint = label(_('Press the new shortcut. Backspace clears it, Esc cancels.'), 'm3-row-sub', {wrap: true});
    await dialog({
        title,
        content: hint,
        buttons: [{id: 'cancel', label: _('Cancel')}],
        onOpen: (win, closeWith) => {
            const keys = new Gtk.EventControllerKey();
            keys.connect('key-pressed', (_c, keyval, _code, state) => {
                const mods = state & Gtk.accelerator_get_default_mod_mask();
                if (keyval === Gdk.KEY_Escape && !mods) {
                    closeWith('cancel');
                } else if (keyval === Gdk.KEY_BackSpace && !mods) {
                    result = '';
                    closeWith('ok');
                } else if (Gtk.accelerator_valid(keyval, mods)) {
                    result = Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mods);
                    closeWith('ok');
                }
                return true;
            });
            win.add_controller(keys);
        },
    });
    return result;
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Keyboard shortcuts'), _('Click a shortcut to change it')));
    const holder = vbox(16);
    page.append(holder);

    const render = () => {
        clearBox(holder);
        for (const [title, entries] of GROUPS()) {
            const rows = entries.filter(([schema, key]) => gs.has(schema, key)).map(([schema, key, name, icon]) => {
                const settings = gs.settings(schema);
                const button = pillButton(accelLabel(settings.get_strv(key)), async () => {
                    const accel = await captureAccel(name);
                    if (accel === null)
                        return;
                    settings.set_strv(key, accel ? [accel] : []);
                    toast();
                    render();
                }, {variant: 'tonal'});
                return row({title: name, icon, trailing: button});
            });
            if (rows.length === 0)
                continue;
            holder.append(sectionLabel(title));
            holder.append(listCard(rows));
        }
        holder.append(listCard([row({
            title: _('Reset all shortcuts'), icon: 'restart_alt',
            trailing: pillButton(_('Reset'), () => {
                for (const [, entries] of GROUPS())
                    for (const [schema, key] of entries)
                        gs.settings(schema)?.reset(key);
                toast();
                render();
            }, {variant: 'tonal'}),
        })]));
    };
    render();
    return page;
}
