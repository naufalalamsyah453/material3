import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {_} from '../i18n.js';
import {gs, hasCommand, run} from '../sys.js';
import {
    clearBox, customSwitch, dialog, dropdown, fire, heading, hbox, label, listCard, note, pillButton, row,
    rowsFrom, sectionLabel, spinnerRow, toast, vbox,
} from '../ui.js';

const BUS = 'org.gnome.Mutter.DisplayConfig';
const PATH = '/org/gnome/Mutter/DisplayConfig';
const C = 'org.gnome.settings-daemon.plugins.color';
const MUTTER = 'org.gnome.mutter';
const FRACTIONAL = 'scale-monitor-framebuffer';

const call = (method, params = null, replyType = null) => new Promise((resolve, reject) => {
    Gio.DBus.session.call(BUS, PATH, BUS, method, params, replyType, Gio.DBusCallFlags.NONE, -1, null,
        (connection, res) => {
            try {
                resolve(connection.call_finish(res));
            } catch (e) {
                reject(e);
            }
        });
});

const near = (a, b) => Math.abs(a - b) < 0.001;
const odd = transform => transform % 2 === 1;
const hz = r => `${(Math.round(r * 100) / 100).toString()} Hz`;

/** GetCurrentState -> plain objects. */
function parse(raw) {
    const [serial, monitorsRaw, logicalsRaw, props] = raw;
    const monitors = monitorsRaw.map(([id, modes, p]) => ({
        connector: id[0],
        name: p['display-name'] ?? id[0],
        builtin: !!p['is-builtin'],
        modes: modes.map(([mid, w, h, refresh, preferred, scales, mp]) => ({
            id: mid, w, h, refresh, preferred, scales,
            current: !!mp['is-current'],
        })),
    }));
    const layoutMode = props['layout-mode'] ?? 1;
    const mirrored = logicalsRaw.some(l => l[5].length > 1);
    const entries = monitors.map(monitor => {
        const logical = logicalsRaw.find(l => l[5].some(m => m[0] === monitor.connector));
        const current = monitor.modes.find(m => m.current) ?? monitor.modes[0];
        return {
            monitor,
            enabled: !!logical,
            modeId: current?.id,
            scale: logical?.[2] ?? current?.preferred ?? 1,
            transform: logical?.[3] ?? 0,
            primary: !!logical?.[4],
            x: logical?.[0] ?? 0,
            y: logical?.[1] ?? 0,
            relation: 'right',
        };
    });
    return {serial, layoutMode, mirrored, entries, canScale: true};
}

const modeOf = e => e.monitor.modes.find(m => m.id === e.modeId);

function sizeOf(e, layoutMode) {
    const mode = modeOf(e);
    let w = mode.w;
    let h = mode.h;
    if (odd(e.transform))
        [w, h] = [h, w];
    return layoutMode === 1 ? [Math.round(w / e.scale), Math.round(h / e.scale)] : [w, h];
}

/** Relations of the other monitors, seen from the reference one. */
function deriveRelations(state) {
    const on = state.entries.filter(e => e.enabled);
    const ref = on.find(e => e.primary) ?? on[0];
    if (!ref)
        return;
    const [rw, rh] = sizeOf(ref, state.layoutMode);
    for (const e of on) {
        if (e === ref)
            continue;
        const [w] = sizeOf(e, state.layoutMode);
        if (e.x >= ref.x + rw)
            e.relation = 'right';
        else if (e.x + w <= ref.x)
            e.relation = 'left';
        else if (e.y >= ref.y + rh)
            e.relation = 'below';
        else
            e.relation = 'above';
    }
}

/** Place monitors around the reference one and move the layout to the origin. */
function layout(state) {
    const on = state.entries.filter(e => e.enabled);
    const ref = on.find(e => e.primary) ?? on[0];
    if (!ref)
        return;
    const [rw, rh] = sizeOf(ref, state.layoutMode);
    ref.x = 0;
    ref.y = 0;
    let right = rw;
    let left = 0;
    let below = rh;
    let above = 0;
    for (const e of on) {
        if (e === ref)
            continue;
        const [w, h] = sizeOf(e, state.layoutMode);
        if (e.relation === 'left') {
            left -= w;
            e.x = left;
            e.y = 0;
        } else if (e.relation === 'below') {
            e.x = 0;
            e.y = below;
            below += h;
        } else if (e.relation === 'above') {
            above -= h;
            e.x = 0;
            e.y = above;
        } else {
            e.x = right;
            e.y = 0;
            right += w;
        }
    }
    const minX = Math.min(...on.map(e => e.x));
    const minY = Math.min(...on.map(e => e.y));
    for (const e of on) {
        e.x -= minX;
        e.y -= minY;
    }
}

function toVariant(state, method) {
    layout(state);
    const logicals = state.entries.filter(e => e.enabled).map(e => [
        e.x, e.y, e.scale, e.transform, e.primary, [[e.monitor.connector, e.modeId, {}]],
    ]);
    return new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [state.serial, method, logicals, {}]);
}

const clone = state => ({
    ...state,
    entries: state.entries.map(e => ({...e})),
});

const same = (a, b) => JSON.stringify(a.entries.map(e => [e.enabled, e.modeId, e.scale, e.transform, e.primary,
    e.relation])) === JSON.stringify(b.entries.map(e => [e.enabled, e.modeId, e.scale, e.transform, e.primary,
    e.relation]));

/** "Keep these settings?" with a countdown; resolves true to keep. */
function keepDialog() {
    return new Promise(resolve => {
        let left = 15;
        const text = label('', 'm3-row-sub');
        let timer = 0;
        let closeFn = null;
        const update = () => text.set_label(_('Reverting in %d seconds').format(left));
        update();
        dialog({
            title: _('Keep these display settings?'),
            content: text,
            buttons: [
                {id: 'revert', label: _('Revert')},
                {id: 'keep', label: _('Keep'), variant: 'filled'},
            ],
            onOpen: (_win, closeWith) => {
                closeFn = closeWith;
                timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                    left -= 1;
                    update();
                    if (left <= 0) {
                        timer = 0;
                        closeFn('revert');
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            },
        }).then(answer => {
            if (timer)
                GLib.source_remove(timer);
            resolve(answer === 'keep');
        });
    });
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Displays'), _('Resolution, scale, orientation, arrangement and Night Light')));

    const holder = vbox(16);
    holder.append(spinnerRow(_('Loading...')));
    page.append(holder);

    let applied = null;
    let pending = null;
    let busy = false;

    const render = () => {
        clearBox(holder);
        if (!pending) {
            holder.append(note(_('Display settings are unavailable in this session.'), 'desktop_access_disabled'));
            return;
        }
        if (pending.mirrored) {
            holder.append(note(_('Mirrored displays are active. Use the GNOME display panel to change them.'), 'cast'));
            if (hasCommand('gnome-control-center')) {
                holder.append(listCard([row({
                    title: _('Open GNOME display settings'), icon: 'desktop_windows',
                    trailing: pillButton(_('Open'), () => run(['gnome-control-center', 'display']), {variant: 'tonal'}),
                })]));
            }
            return;
        }

        const entries = pending.entries;
        const enabledCount = entries.filter(e => e.enabled).length;
        const ref = entries.filter(e => e.enabled).find(e => e.primary) ?? entries.find(e => e.enabled);

        for (const e of entries) {
            const rows = [];
            const mode = modeOf(e);
            if (entries.length > 1) {
                rows.push(customSwitch({
                    title: _('Enabled'), icon: e.monitor.builtin ? 'laptop' : 'desktop_windows',
                    get: () => e.enabled,
                    set: on => {
                        if (!on && enabledCount <= 1)
                            return;
                        e.enabled = on;
                        if (on) {
                            e.relation = 'right';
                            const preferred = e.monitor.modes.find(m => m.preferred) ?? e.monitor.modes[0];
                            e.modeId = preferred.id;
                            e.scale = preferred.preferred;
                        } else if (e.primary) {
                            e.primary = false;
                        }
                        if (!entries.some(x => x.enabled && x.primary))
                            entries.find(x => x.enabled).primary = true;
                        render();
                    },
                }));
            }
            if (e.enabled) {
                const resolutions = [...new Map(e.monitor.modes
                    .map(m => [`${m.w}x${m.h}`, {id: `${m.w}x${m.h}`, label: `${m.w} × ${m.h}`, w: m.w, h: m.h}]))
                    .values()].sort((a, b) => b.w * b.h - a.w * a.h);
                const resolution = dropdown(resolutions, `${mode.w}x${mode.h}`, id => {
                    const [w, h] = id.split('x').map(Number);
                    const candidates = e.monitor.modes.filter(m => m.w === w && m.h === h);
                    const best = candidates.reduce((a, b) =>
                        Math.abs(a.refresh - mode.refresh) <= Math.abs(b.refresh - mode.refresh) ? a : b);
                    e.modeId = best.id;
                    if (!best.scales.some(s => near(s, e.scale)))
                        e.scale = best.preferred;
                    render();
                });
                rows.push(row({title: _('Resolution'), icon: 'aspect_ratio', trailing: resolution.widget}));

                const rates = e.monitor.modes.filter(m => m.w === mode.w && m.h === mode.h)
                    .sort((a, b) => b.refresh - a.refresh).map(m => ({id: m.id, label: hz(m.refresh)}));
                const refresh = dropdown(rates, e.modeId, id => {
                    e.modeId = id;
                    render();
                });
                rows.push(row({title: _('Refresh rate'), icon: 'speed', trailing: refresh.widget}));

                const scales = mode.scales.map(s => ({id: s, label: `${Math.round(s * 100)}%`}));
                const scale = dropdown(scales, mode.scales.find(s => near(s, e.scale)) ?? e.scale, id => {
                    e.scale = id;
                    render();
                });
                rows.push(row({title: _('Scale'), icon: 'aspect_ratio', trailing: scale.widget}));

                const orientation = dropdown([
                    {id: 0, label: _('Landscape')}, {id: 1, label: _('Portrait (right)')},
                    {id: 2, label: _('Landscape (flipped)')}, {id: 3, label: _('Portrait (left)')},
                ], e.transform % 4, id => {
                    e.transform = id;
                    render();
                });
                rows.push(row({title: _('Orientation'), icon: 'screen_rotation', trailing: orientation.widget}));

                if (enabledCount > 1) {
                    rows.push(customSwitch({
                        title: _('Primary display'), icon: 'star',
                        get: () => e.primary,
                        set: on => {
                            if (!on)
                                return;
                            entries.forEach(x => {
                                x.primary = x === e;
                            });
                            render();
                        },
                    }));
                    if (e !== ref) {
                        const relation = dropdown([
                            {id: 'right', label: _('Right of %s').format(ref.monitor.name)},
                            {id: 'left', label: _('Left of %s').format(ref.monitor.name)},
                            {id: 'above', label: _('Above %s').format(ref.monitor.name)},
                            {id: 'below', label: _('Below %s').format(ref.monitor.name)},
                        ], e.relation, id => {
                            e.relation = id;
                        });
                        rows.push(row({title: _('Position'), icon: 'open_with', trailing: relation.widget}));
                    }
                }
            }
            holder.append(sectionLabel(`${e.monitor.name}${e.monitor.builtin ? ` · ${_('Built-in display')}` : ''}`));
            holder.append(listCard(rows));
        }

        const dirty = !same(pending, applied);
        if (dirty) {
            const bar = hbox(8);
            bar.halign = Gtk.Align.END;
            bar.append(pillButton(_('Revert'), () => {
                pending = clone(applied);
                render();
            }));
            bar.append(pillButton(_('Apply'), () => fire(apply()), {variant: 'filled'}));
            holder.append(bar);
        }
    };

    const load = async () => {
        try {
            const reply = await call('GetCurrentState');
            const state = parse(reply.recursiveUnpack());
            deriveRelations(state);
            applied = state;
            pending = clone(state);
        } catch (e) {
            console.error(`material3: display state: ${e.message}`);
            applied = pending = null;
        }
        render();
    };

    const apply = async () => {
        if (busy || !pending)
            return;
        busy = true;
        const before = clone(applied);
        try {
            await call('ApplyMonitorsConfig', toVariant(clone(pending), 1));
            const keep = await keepDialog();
            if (keep) {
                const fresh = parse((await call('GetCurrentState')).recursiveUnpack());
                const next = clone(pending);
                next.serial = fresh.serial;
                await call('ApplyMonitorsConfig', toVariant(next, 2));
                toast(_('Display settings saved'));
            } else {
                const fresh = parse((await call('GetCurrentState')).recursiveUnpack());
                before.serial = fresh.serial;
                await call('ApplyMonitorsConfig', toVariant(before, 1));
            }
        } catch (e) {
            console.error(`material3: apply displays: ${e.message}`);
            toast(_('Could not apply the display settings'));
        }
        busy = false;
        await load();
    };

    Gio.DBus.session.signal_subscribe(BUS, BUS, 'MonitorsChanged', PATH, null, Gio.DBusSignalFlags.NONE, () => {
        if (!busy && pending && applied && same(pending, applied))
            fire(load());
    });

    page.append(sectionLabel(_('Fractional scaling')));
    if (gs.has(MUTTER, 'experimental-features')) {
        const mutter = gs.settings(MUTTER);
        const features = () => mutter.get_strv('experimental-features');
        const fractional = customSwitch({
            title: _('Fractional scaling'), sub: _('Allow scales such as 125% and 150%'), icon: 'aspect_ratio',
            get: () => features().includes(FRACTIONAL),
            set: on => {
                const rest = features().filter(f => f !== FRACTIONAL);
                mutter.set_strv('experimental-features', on ? [...rest, FRACTIONAL] : rest);
                setTimeout(() => fire(load()), 800);
            },
        });
        page.append(listCard([fractional]));
    }

    page.append(sectionLabel(_('Night Light')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: C, key: 'night-light-enabled', title: _('Night Light'),
            sub: _('Make the screen warmer in the evening'), icon: 'nightlight'},
        {t: 'switch', schema: C, key: 'night-light-schedule-automatic', title: _('Sunset to sunrise'),
            sub: _('Follow the sun automatically'), icon: 'wb_twilight'},
    ])));
    const temp = rowsFrom([{
        t: 'slider', schema: C, key: 'night-light-temperature', title: _('Color temperature'),
        min: 1700, max: 4700, step: 100, discrete: true, integer: true,
        leftIcon: 'local_fire_department', rightIcon: 'light_mode', format: v => `${Math.round(v)} K`,
    }]);
    if (temp.length)
        page.append(listCard(temp));

    let started = false;
    page.refresh = () => {
        if (started)
            return;
        started = true;
        fire(load());
    };
    return page;
}
