import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {_} from '../i18n.js';
import {dbusCall, dbusProxy, hasCommand, run} from '../sys.js';
import {
    askText, clearBox, fire, heading, listCard, note, pillButton, row, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

/** Local login users (uid 1000..59999) from the passwd database. */
async function readUsers() {
    const r = await run(['getent', 'passwd']);
    return r.stdout.split('\n').map(l => l.split(':')).filter(f => {
        const uid = Number(f[2]);
        return f.length >= 7 && uid >= 1000 && uid < 60000 && !/nologin|false$/.test(f[6]);
    }).map(f => ({uid: Number(f[2]), name: f[0], real: f[4].split(',')[0] || f[0]}));
}

async function usersSection(holder) {
    const users = await readUsers();
    const me = GLib.get_user_name();
    const accounts = await dbusProxy(Gio.BusType.SYSTEM, 'org.freedesktop.Accounts',
        '/org/freedesktop/Accounts', 'org.freedesktop.Accounts');
    holder.append(sectionLabel(_('Users')));
    holder.append(listCard(users.map(u => row({
        title: u.real, sub: u.name === me ? `${u.name} · ${_('You')}` : u.name, icon: 'account_circle',
        trailing: u.name === me && accounts ? pillButton(_('Rename'), async () => {
            const name = await askText({title: _('Full name'), initial: u.real, okLabel: _('Save')});
            if (name === null || !name.trim())
                return;
            const found = await dbusCall(accounts, 'FindUserByName', new GLib.Variant('(s)', [me]));
            const path = found?.deepUnpack()[0];
            const user = path && await dbusProxy(Gio.BusType.SYSTEM, 'org.freedesktop.Accounts', path,
                'org.freedesktop.Accounts.User');
            const ok = user && await dbusCall(user, 'SetRealName', new GLib.Variant('(s)', [name.trim()]));
            toast(ok ? _('Settings updated') : _('Could not change the name'));
        }, {variant: 'tonal'}) : null,
    }))));
}

async function printersSection(holder) {
    if (!hasCommand('lpstat'))
        return;
    const [list, def] = await Promise.all([run(['lpstat', '-p']), run(['lpstat', '-d'])]);
    const names = list.stdout.split('\n').map(l => /^printer (\S+)/.exec(l)?.[1]).filter(Boolean);
    const current = /:\s*(\S+)\s*$/.exec(def.stdout.trim())?.[1] ?? '';
    holder.append(sectionLabel(_('Printers')));
    if (names.length === 0) {
        holder.append(note(_('No printers configured'), 'print'));
        return;
    }
    holder.append(listCard(names.map(name => row({
        title: name.replace(/_/g, ' '), sub: name === current ? _('Default printer') : '', icon: 'print',
        trailing: name === current ? null : pillButton(_('Make default'), () => fire(
            run(['lpoptions', '-d', name]).then(r => toast(r.ok ? _('Settings updated') : _('Could not change the default')))),
        {variant: 'tonal'}),
    }))));
}

async function accountsSection(holder) {
    const proxy = await dbusProxy(Gio.BusType.SESSION, 'org.gnome.OnlineAccounts',
        '/org/gnome/OnlineAccounts', 'org.freedesktop.DBus.ObjectManager');
    if (!proxy)
        return;
    const reply = await dbusCall(proxy, 'GetManagedObjects', null);
    const entries = [];
    for (const [, ifaces] of Object.entries(reply?.deepUnpack()[0] ?? {})) {
        const account = ifaces['org.gnome.OnlineAccounts.Account'];
        if (!account)
            continue;
        const get = k => account[k]?.deepUnpack();
        entries.push([get('ProviderName') ?? '', get('PresentationIdentity') ?? get('Identity') ?? '']);
    }
    holder.append(sectionLabel(_('Online Accounts')));
    if (entries.length === 0)
        holder.append(note(_('No online accounts. Add accounts in your desktop account service.'), 'cloud'));
    else
        holder.append(listCard(entries.map(([provider, identity]) => row({title: provider, sub: identity, icon: 'cloud'}))));
}

async function colorSection(holder) {
    if (!hasCommand('colormgr'))
        return;
    const r = await run(['colormgr', 'get-devices']);
    const devices = [];
    let current = null;
    for (const line of r.stdout.split('\n')) {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (key === 'Object Path') {
            current = {};
            devices.push(current);
        } else if (current && key === 'Model') {
            current.model = value;
        } else if (current && key === 'Kind') {
            current.kind = value;
        } else if (current && /^Profile 1/.test(key)) {
            current.profile = value;
        }
    }
    const shown = devices.filter(d => d.model);
    if (shown.length === 0)
        return;
    holder.append(sectionLabel(_('Color')));
    holder.append(listCard(shown.map(d => row({title: d.model, sub: d.kind ?? '', icon: 'palette'}))));
}

async function thunderboltSection(holder) {
    if (!hasCommand('boltctl'))
        return;
    const r = await run(['boltctl', 'list']);
    if (!r.ok)
        return;
    const devices = [];
    for (const line of r.stdout.split('\n')) {
        const name = /[●○]\s+(.+)$/.exec(line)?.[1];
        const uuid = /uuid:\s+(\S+)/.exec(line)?.[1];
        const status = /status:\s+(\S+)/.exec(line)?.[1];
        if (name)
            devices.push({name});
        else if (uuid && devices.length)
            devices.at(-1).uuid = uuid;
        else if (status && devices.length)
            devices.at(-1).status = status;
    }
    if (devices.length === 0)
        return;
    holder.append(sectionLabel(_('Thunderbolt')));
    holder.append(listCard(devices.map(d => row({
        title: d.name, sub: d.status ?? '', icon: 'bolt',
        trailing: d.uuid && d.status === 'connected' ? pillButton(_('Authorize'), () => fire(
            run(['boltctl', 'enroll', d.uuid]).then(res => toast(res.ok ? _('Settings updated') : _('Could not authorize')))),
        {variant: 'tonal'}) : null,
    }))));
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('More Settings'), _('Accounts, printers and devices')));
    const holder = vbox(16);
    holder.append(spinnerRow(_('Loading...')));
    page.append(holder);

    page.refresh = () => fire((async () => {
        const body = vbox(16);
        for (const section of [usersSection, printersSection, accountsSection, colorSection, thunderboltSection]) {
            try {
                await section(body);
            } catch (e) {
                console.error(`material3: ${section.name} failed: ${e.message}`);
            }
        }
        clearBox(holder);
        holder.append(body);
    })());
    return page;
}
