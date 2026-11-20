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
