import {_} from '../i18n.js';
import {debounce, hasCommand, run} from '../sys.js';
import {
    card, clearBox, customSwitch, fire, heading, listCard, note, rowsFrom, sectionLabel, selectRow, sliderBlock, vbox,
} from '../ui.js';

const SND = 'org.gnome.desktop.sound';

function endpoint(title, target, iconOn, iconOff) {
    const state = {volume: 0, muted: false};
    const block = sliderBlock({
        title, min: 0, max: 100, step: 1, value: 0, leftIcon: iconOff, rightIcon: iconOn,
        format: v => `${Math.round(v)}%`,
        onChange: debounce(v => {
            if (Math.abs(v - state.volume * 100) > 0.5)
                run(['wpctl', 'set-volume', target, `${Math.round(v) / 100}`]);
        }, 60),
    });
    const mute = customSwitch({
        title: _('Mute'), icon: iconOff, get: () => false,
        set: on => run(['wpctl', 'set-mute', target, on ? '1' : '0']),
    });
    const refresh = async () => {
        const r = await run(['wpctl', 'get-volume', target]);
        const m = r.stdout.match(/Volume:\s+([\d.]+)(\s+\[MUTED\])?/);
        if (!m)
            return;
        state.volume = parseFloat(m[1]);
        state.muted = !!m[2];
        block.setValue(Math.round(state.volume * 100));
        mute.setActive(state.muted);
    };
    return {widgets: [card(block.widget), listCard([mute])], refresh};
}

/** Audio devices of one kind ('Sinks' or 'Sources') from `wpctl status`. */
async function listDevices(kind) {
    const r = await run(['wpctl', 'status']);
    const items = [];
    let top = '';
    let section = '';
    for (const line of r.stdout.split('\n')) {
        if (/^\S/.test(line)) {
            top = line.trim();
            continue;
        }
        const head = line.match(/[├└]─\s+([A-Za-z ]+):/);
        if (head) {
            section = head[1].trim();
            continue;
        }
        const m = line.match(/^[\s│]*(\*)?\s*(\d+)\.\s+(.+?)(\s+\[vol:.*\])?\s*$/);
        if (m && top === 'Audio' && section === kind)
            items.push({id: m[2], name: m[3], current: !!m[1]});
    }
    return items;
}

/** A device picker that fills in once `wpctl status` answered. */
function devicePicker(kind, title, icon) {
    const holder = vbox(0);
    const refresh = async () => {
        const items = await listDevices(kind);
        clearBox(holder);
        if (items.length === 0)
            return;
        let current = items.find(i => i.current)?.id ?? items[0].id;
        holder.append(listCard([selectRow({
            title, icon,
            options: items.map(i => [i.id, i.name]),
            get: () => current,
            set: id => {
                current = id;
                fire(run(['wpctl', 'set-default', id]));
            },
        })]));
    };
    return {widget: holder, refresh};
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Sound'), _('Volume and system sounds')));
    if (!hasCommand('wpctl')) {
        page.append(note(_('PipeWire (wpctl) was not found on this system.'), 'volume_off'));
    } else {
        const out = endpoint(_('Output volume'), '@DEFAULT_AUDIO_SINK@', 'volume_up', 'volume_mute');
        const input = endpoint(_('Input volume'), '@DEFAULT_AUDIO_SOURCE@', 'mic', 'mic_off');
        const outDevice = devicePicker('Sinks', _('Output device'), 'speaker');
        const inDevice = devicePicker('Sources', _('Input device'), 'mic');
        page.append(outDevice.widget);
        out.widgets.forEach(w => page.append(w));
        page.append(sectionLabel(_('Microphone')));
        page.append(inDevice.widget);
        input.widgets.forEach(w => page.append(w));
        page.refresh = () => {
            fire(out.refresh());
            fire(input.refresh());
            fire(outDevice.refresh());
            fire(inDevice.refresh());
        };
    }
    page.append(sectionLabel(_('System sounds')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: SND, key: 'event-sounds', title: _('System sounds'), icon: 'notifications_active'},
        {t: 'switch', schema: SND, key: 'allow-volume-above-100-percent', title: _('Allow volume above 100%'),
            icon: 'volume_up'},
    ])));
    return page;
}
