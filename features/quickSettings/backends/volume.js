import Gvc from 'gi://Gvc';

import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {Backend, SignalBag} from './base.js';

/**
 * Default output volume through the shell's shared Gvc mixer, following the
 * same mute/volume rules as the stock volume slider.
 */
export class VolumeBackend extends Backend {
    constructor() {
        super();

        this._control = getMixerControl();
        this._stream = null;
        this._streamSignals = new SignalBag();

        this._signals.connect(this._control, 'state-changed', () => this._onState());
        this._signals.connect(this._control, 'default-sink-changed', () => this._readSink());
        this._onState();
    }

    get available() {
        return this._stream !== null;
    }

    get value() {
        if (!this._stream || this._stream.is_muted)
            return 0;
        const norm = this._control.get_vol_max_norm();
        return Math.max(0, Math.min(100, Math.round(this._stream.volume / norm * 100)));
    }

    setValue(value) {
        const stream = this._stream;
        if (!stream)
            return;

        const volume = Math.max(0, Math.min(100, value)) / 100 *
            this._control.get_vol_max_norm();
        const wasMuted = stream.is_muted;
        let changed;
        if (volume < 1) {
            changed = stream.set_volume(0);
            if (!wasMuted)
                stream.change_is_muted(true);
        } else {
            changed = stream.set_volume(volume);
            if (wasMuted)
                stream.change_is_muted(false);
        }
        if (changed)
            stream.push_volume();
    }

    _onState() {
        if (this._control.get_state() === Gvc.MixerControlState.READY)
            this._readSink();
    }

    _readSink() {
        this._streamSignals.clear();
        this._stream = this._control.get_default_sink() ?? null;
        if (this._stream) {
            this._streamSignals.connect(this._stream, 'notify::volume', () => this._emit());
            this._streamSignals.connect(this._stream, 'notify::is-muted', () => this._emit());
        }
        this._emit();
    }

    _onDestroy() {
        this._streamSignals.clear();
        this._stream = null;
    }
}
