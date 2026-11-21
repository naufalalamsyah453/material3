import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MprisSource} from 'resource:///org/gnome/shell/ui/mpris.js';
import {_} from '../../../i18n.js';

import {Backend} from './base.js';

/** Active media player through the shell's MPRIS source. */
export class MediaBackend extends Backend {
    constructor() {
        super();

        this._players = new Map();
        this._player = null;
        this._source = new MprisSource();

        this._signals.connect(this._source, 'player-added', (_s, player) => this._watch(player));
        this._signals.connect(this._source, 'player-removed', (_s, player) => this._unwatch(player));
        for (const player of this._source.players)
            this._watch(player);
    }

    get state() {
        const player = this._player;
        if (!player) {
            return {
                available: false,
                playing: false,
                title: _('Nothing playing'),
                subtitle: _('Start a media player'),
                coverUrl: '',
            };
        }

        const artists = player.trackArtists?.join(', ') ?? '';
        const app = player.source?.title ?? '';
        return {
            available: true,
            playing: player.status === 'Playing',
            title: player.trackTitle,
            subtitle: [artists, app].filter(Boolean).join(' • '),
            coverUrl: player.trackCoverUrl ?? '',
        };
    }

    /** Position, length (seconds) and shuffle of the active player, read straight from MPRIS. */
    async progress() {
        const player = this._player;
        const name = player?._busName ?? player?.busName ?? player?.source?.busName;
        if (!name)
            return null;
        try {
            const get = prop => new Promise((resolve, reject) => {
                Gio.DBus.session.call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                    new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', prop]), null,
                    Gio.DBusCallFlags.NONE, 1000, null, (conn, res) => {
                        try {
                            resolve(conn.call_finish(res).deepUnpack()[0].deepUnpack());
                        } catch (e) {
                            reject(e);
                        }
                    });
            });
            const [position, metadata, shuffle] = await Promise.all([
                get('Position'), get('Metadata'), get('Shuffle').catch(() => false)]);
            const length = metadata?.['mpris:length']?.deepUnpack?.() ?? 0;
            return {position: Number(position) / 1e6, length: Number(length) / 1e6, shuffle: !!shuffle, name};
        } catch {
            return null;
        }
    }

    /** Seek by `delta` seconds, or toggle shuffle on the active player. */
    seekBy(delta) {
        const name = this._player?._busName ?? this._player?.busName ?? this._player?.source?.busName;
        if (!name)
            return;
        Gio.DBus.session.call(name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'Seek',
            new GLib.Variant('(x)', [Math.round(delta * 1e6)]), null, Gio.DBusCallFlags.NONE, 1000, null, null);
    }

    setShuffle(on) {
        const name = this._player?._busName ?? this._player?.busName ?? this._player?.source?.busName;
        if (!name)
            return;
        Gio.DBus.session.call(name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'Shuffle', new GLib.Variant('b', on)]),
            null, Gio.DBusCallFlags.NONE, 1000, null, null);
    }

    playPause() {
        this._player?.playPause();
    }

    next() {
        this._player?.next();
    }

    previous() {
        this._player?.previous();
    }

    _watch(player) {
        if (this._players.has(player))
            return;
        this._players.set(player, player.connect('changed', () => this._select()));
        this._select();
    }

    _unwatch(player) {
        const id = this._players.get(player);
        if (id === undefined)
            return;
        player.disconnect(id);
        this._players.delete(player);
        this._select();
    }

    _select() {
        const players = [...this._players.keys()];
        this._player = players.find(p => p.status === 'Playing') ??
            (players.includes(this._player) ? this._player : players[0] ?? null);
        this._emit();
    }

    _onDestroy() {
        for (const [player, id] of this._players)
            player.disconnect(id);
        this._players.clear();
        this._player = null;
        this._source = null;
    }
}
