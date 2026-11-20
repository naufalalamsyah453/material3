import {_} from '../i18n.js';
import {hasCommand, readFile, run} from '../sys.js';
import {
    askText, fire, heading, listCard, note, pillButton, row, sectionLabel, toast, vbox,
} from '../ui.js';


export function build() {
    const page = vbox(16);
    page.append(heading(_('Sharing'), _('Device name and remote access')));
    const name = row({title: _('Device name'), sub: '...', icon: 'badge'});
    name.append(pillButton(_('Rename'), () => fire((async () => {
        const next = await askText({title: _('Device name'), initial: name.current ?? '', okLabel: _('Rename')});
        if (!next)
            return;
        const r = await run(['hostnamectl', 'set-hostname', '--pretty', next]);
        toast(r.ok ? _('Settings updated') : _('Could not change the name'));
        page.refresh();
    })()), {variant: 'tonal'}));
    page.append(listCard([name]));

    page.append(sectionLabel(_('Remote access')));
    page.append(note(_('Remote desktop, media sharing and file sharing are configured by their own services. Open More Settings to launch the full GNOME panel.'), 'share'));

    page.refresh = () => {
        if (!hasCommand('hostnamectl')) {
            name.setSub(readFile('/etc/hostname')?.trim() ?? '');
            return;
        }
        fire(run(['hostnamectl', '--pretty']).then(async r => {
            let value = r.stdout.trim();
            if (!value)
                value = (await run(['hostnamectl', '--static'])).stdout.trim();
            name.current = value;
            name.setSub(value);
        }));
    };
    return page;
}
