import {_} from '../i18n.js';
import {debounce, hasCommand, run} from '../sys.js';
import {customSwitch, fire, heading, listCard, note, rowsFrom, sectionLabel, sliderBlock, card, vbox} from '../ui.js';

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

export function build() {
    const page = vbox(16);
    page.append(heading(_('Sound'), _('Volume and system sounds')));
    if (!hasCommand('wpctl')) {
        page.append(note(_('PipeWire (wpctl) was not found on this system.'), 'volume_off'));
    } else {
        const out = endpoint(_('Output volume'), '@DEFAULT_AUDIO_SINK@', 'volume_up', 'volume_mute');
        const input = endpoint(_('Input volume'), '@DEFAULT_AUDIO_SOURCE@', 'mic', 'mic_off');
        out.widgets.forEach(w => page.append(w));
        page.append(sectionLabel(_('Microphone')));
        input.widgets.forEach(w => page.append(w));
        page.refresh = () => {
            fire(out.refresh());
            fire(input.refresh());
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
