import Gtk from 'gi://Gtk?version=4.0';

import {_} from '../i18n.js';
import {formatBytes, hasCommand, run} from '../sys.js';
import {
    clearBox, fire, hbox, heading, label, listCard, pillButton, row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

const SKIP_FS = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'efivarfs', 'overlay', 'ramfs', 'proc', 'sysfs']);

function usageBar(used, size) {
    const bar = new Gtk.ProgressBar({fraction: size > 0 ? Math.min(1, used / size) : 0});
    bar.add_css_class('m3-bar');
    return bar;
}

/** Physical drives (also unmounted ones) from lsblk, usage from df. */
async function readDisks() {
    const [blk, df] = await Promise.all([
        hasCommand('lsblk')
            ? run(['lsblk', '-b', '-J', '-o', 'NAME,PATH,SIZE,TYPE,MODEL,FSTYPE,MOUNTPOINTS,RM,LABEL'])
            : Promise.resolve({ok: false, stdout: ''}),
        run(['df', '-B1', '--output=source,size,used,avail,target']),
    ]);
    const usage = new Map();
    for (const line of df.stdout.split('\n').slice(1)) {
        const [source, size, used, avail] = line.trim().split(/\s+/);
        if (source && !usage.has(source))
            usage.set(source, {size: Number(size), used: Number(used), avail: Number(avail)});
    }

    let tree = [];
    try {
        tree = JSON.parse(blk.stdout).blockdevices ?? [];
    } catch {
        // lsblk missing or too old: fall back to df only.
    }
    const disks = [];
    for (const dev of tree) {
        if (dev.type !== 'disk')
            continue;
        const parts = [];
        const walk = node => {
            const mounts = (node.mountpoints ?? []).filter(Boolean);
            if (node.fstype && !SKIP_FS.has(node.fstype) && node.fstype !== 'swap' && node.type !== 'disk' ||
                (node.type === 'disk' && node.fstype && !(node.children?.length)))
                parts.push({node, mounts, usage: usage.get(node.path)});
            else if (node.type === 'crypt' || node.type === 'lvm')
                parts.push({node, mounts, usage: usage.get(node.path)});
            (node.children ?? []).forEach(walk);
        };
        walk(dev);
        disks.push({dev, parts});
    }
    return {disks, usage};
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Storage'), _('Disk usage')));
    const holder = vbox(12);
    holder.append(spinnerRow(_('Loading...')));
    page.append(holder);

    page.append(sectionLabel(_('Cleanup')));
    page.append(listCard([row({
        title: _('Empty trash'), icon: 'delete_sweep',
        trailing: pillButton(_('Empty'), () => fire(run(['gio', 'trash', '--empty']).then(r => {
            toast(r.ok ? _('Trash emptied') : _('Could not empty the trash'));
        })), {variant: 'tonal'}),
    })]));

    page.refresh = () => fire(readDisks().then(({disks, usage}) => {
        clearBox(holder);
        for (const {dev, parts} of disks) {
            const card = vbox(10, 'm3-card');
            const head = hbox(12);
            head.append(label(dev.model?.trim() || dev.name, 'm3-row-title', {hexpand: true}));
            head.append(label(`${formatBytes(Number(dev.size))}${dev.rm ? ` · ${_('Removable')}` : ''}`, 'm3-row-sub'));
            card.append(head);
            if (parts.length === 0)
                card.append(label(_('No partitions found'), 'm3-row-sub'));
            for (const {node, mounts, usage: u} of parts) {
                const name = node.label || mounts[0] || node.name;
                const top = hbox(8);
                top.append(label(name, 'm3-row-sub', {hexpand: true}));
                top.append(label(u
                    ? _('%s of %s used').format(formatBytes(u.used), formatBytes(u.size))
                    : `${formatBytes(Number(node.size))} · ${mounts.length ? node.fstype : _('Not mounted')}`,
                'm3-row-sub'));
                card.append(top);
                if (u)
                    card.append(usageBar(u.used, u.size));
            }
            holder.append(card);
        }
        if (disks.length === 0) {
            // No lsblk: list mounted filesystems.
            const card = vbox(10, 'm3-card');
            for (const [source, u] of usage) {
                if (!source.startsWith('/dev/') || !u.size)
                    continue;
                const top = hbox(8);
                top.append(label(source, 'm3-row-title', {hexpand: true}));
                top.append(label(_('%s of %s used').format(formatBytes(u.used), formatBytes(u.size)), 'm3-row-sub'));
                card.append(top);
                card.append(usageBar(u.used, u.size));
            }
            holder.append(card);
        }
    }));
    return page;
}
