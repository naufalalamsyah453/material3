import GLib from 'gi://GLib';

import {_} from '../i18n.js';
import {formatBytes, readFile, run} from '../sys.js';
import {clearBox, fire, heading, infoRows, vbox} from '../ui.js';

const field = (text, name) => text?.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.replace(/^"|"$/g, '');

export function build() {
    const page = vbox(16);
    page.append(heading(_('About'), _('This device and its software')));
    const holder = vbox(0);
    page.append(holder);

    page.refresh = () => fire(Promise.all([
        run(['uname', '-r']), run(['gnome-shell', '--version']), run(['hostname']),
    ]).then(([kernel, shell, host]) => {
        const cpu = readFile('/proc/cpuinfo')?.match(/model name\s*:\s*(.*)/)?.[1];
        const mem = readFile('/proc/meminfo')?.match(/MemTotal:\s+(\d+)/)?.[1];
        const os = readFile('/etc/os-release');
        clearBox(holder);
        holder.append(infoRows([
            [_('Device name'), host.stdout.trim()],
            [_('Operating system'), field(os, 'PRETTY_NAME') ?? '-'],
            [_('GNOME'), shell.stdout.replace('GNOME Shell', '').trim() || '-'],
            [_('Kernel'), kernel.stdout.trim()],
            [_('Processor'), cpu ?? '-'],
            [_('Memory'), mem ? formatBytes(Number(mem) * 1024) : '-'],
            [_('Windowing system'), (GLib.getenv('XDG_SESSION_TYPE') ?? '-').replace(/^./, c => c.toUpperCase())],
        ]));
    }));
    return page;
}
