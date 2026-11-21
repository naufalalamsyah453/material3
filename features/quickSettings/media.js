import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {loadCover} from './cover.js';

import {px} from './ui.js';
import {centerBin, pressFeedback, symbolIcon, truncatedLabel} from './widgets.js';

const TEXT_WIDTH = 120;
const COVER_SIZE = 44;

class MediaCard {
    /**
     * @param {object} backend MediaBackend
     */
    constructor(backend) {
        this._backend = backend;

        this.actor = new St.BoxLayout({
            style_class: 'm3-media',
            width: px(328),
            height: px(72),
            style: `spacing: ${px(12)}px;`,
        });

        this._cover = new St.Bin({
            style_class: 'm3-media-cover',
            width: px(COVER_SIZE),
            height: px(COVER_SIZE),
            x_align: Clutter.ActorAlign.START,
            child: symbolIcon('music_note', {
                size: 22,
                filled: true,
                styleClass: 'm3-media-cover-icon',
            }),
        });
        this._coverIcon = this._cover.get_child();
        this._coverIcon.x_align = Clutter.ActorAlign.CENTER;
        this._coverIcon.y_align = Clutter.ActorAlign.CENTER;
        this._coverUrl = '';
        this._coverCancel = null;
        this.actor.add_child(this._cover);

        const textBox = new St.BoxLayout({
            style_class: 'm3-media-text',
            orientation: Clutter.Orientation.VERTICAL,
            width: px(TEXT_WIDTH),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = truncatedLabel('', 'm3-media-title', TEXT_WIDTH);
        this._subtitle = truncatedLabel('', 'm3-media-subtitle', TEXT_WIDTH);
        textBox.add_child(this._title);
        textBox.add_child(this._subtitle);
        this.actor.add_child(textBox);

        const controls = new St.BoxLayout({
            style_class: 'm3-media-controls',
            style: `spacing: ${px(4)}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._previous = this._controlButton('skip_previous', 32, 20);
        this._play = this._controlButton('pause', 40, 22, 'm3-media-play');
        this._next = this._controlButton('skip_next', 32, 20);

        this._previous.connect('clicked', () => this._backend.previous());
        this._play.connect('clicked', () => this._backend.playPause());
        this._next.connect('clicked', () => this._backend.next());

        controls.add_child(this._previous);
        controls.add_child(this._play);
        controls.add_child(this._next);
        this.actor.add_child(controls);

        this._unsubscribe = backend.subscribe(() => this.sync());
        this.actor.connect('destroy', () => {
            this._unsubscribe();
            this._coverCancel?.cancel();
        });
        this.sync();
    }

    sync() {
        const state = this._backend.state;
        this._title.set_text(state.title ?? '');
        this._subtitle.set_text(state.subtitle ?? '');
        this._playIcon.set_text(state.playing ? 'pause' : 'play_arrow');
        this._syncCover(state.coverUrl ?? '');

        for (const button of [this._previous, this._play, this._next]) {
            button.reactive = state.available;
            button.opacity = state.available ? 255 : 110;
        }
    }

    /** Show the playing track's cover (album art or video thumbnail) in place of the note. */
    _syncCover(url) {
        if (url === this._coverUrl)
            return;
        this._coverUrl = url;
        this._coverCancel?.cancel();
        this._coverCancel = null;

        if (!url) {
            this._setCover(null);
            return;
        }

        const cancel = new Gio.Cancellable();
        this._coverCancel = cancel;
        loadCover(url, px(COVER_SIZE) * 2, cancel).then(path => {
            if (!cancel.is_cancelled())
                this._setCover(path);
        }).catch(e => {
            if (cancel.is_cancelled())
                return;
            console.error(`material3: could not load the cover: ${e.message}`);
            this._setCover(null);
        });
    }

    _setCover(path) {
        if (!path) {
            this._cover.set_style(null);
            this._coverIcon.visible = true;
            return;
        }
        this._cover.set_style(
            `background-image: url("${GLib.filename_to_uri(path, null)}"); ` +
            `background-size: ${px(COVER_SIZE)}px ${px(COVER_SIZE)}px;`);
        this._coverIcon.visible = false;
    }

    _controlButton(iconName, size, iconSize, styleClass = '') {
        const button = new St.Button({
            style_class: `m3-media-btn ${styleClass}`.trim(),
            width: px(size),
            height: px(size),
            can_focus: true,
            reactive: true,
        });

        const inner = new St.Bin({
            width: px(size),
            height: px(size),
            child: symbolIcon(iconName, {size: iconSize, filled: true}),
        });
        inner.get_child().x_align = Clutter.ActorAlign.CENTER;
        inner.get_child().y_align = Clutter.ActorAlign.CENTER;
        button.set_child(inner);
        pressFeedback(button);

        if (iconName === 'pause')
            this._playIcon = inner.get_child();

        return button;
    }
}

const CARD_W = 328;
const CARD_H = 176;

/**
 * Cover style: the album art fills the whole card under a dark gradient,
 * with the title bottom-left, a big play pill, and a row of prev / seek bar /
 * next / shuffle.
 */
class CoverMediaCard {
    constructor(backend) {
        this._backend = backend;
        this._coverUrl = '';
        this._coverCancel = null;
        this._progress = null;
        this._seekFraction = null;
        this._timerId = 0;

        this.actor = new St.Widget({
            style_class: 'm3-cm',
            width: px(CARD_W),
            height: px(CARD_H),
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this.actor.add_child(new St.Widget({style_class: 'm3-cm-shade', x_expand: true, y_expand: true}));

        const body = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style: `padding: ${px(14)}px; spacing: ${px(6)}px;`,
        });
        this.actor.add_child(body);

        const badge = new St.Bin({
            style_class: 'm3-cm-badge', width: px(32), height: px(32), x_align: Clutter.ActorAlign.START,
            child: symbolIcon('music_note', {size: 18, filled: true, styleClass: 'm3-cm-icon'}),
        });
        body.add_child(badge);
        body.add_child(new St.Widget({y_expand: true}));

        const middle = new St.BoxLayout({x_expand: true, style: `spacing: ${px(8)}px;`});
        const texts = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = truncatedLabel('', 'm3-cm-title', 190);
        this._subtitle = truncatedLabel('', 'm3-cm-subtitle', 190);
        texts.add_child(this._title);
        texts.add_child(this._subtitle);
        middle.add_child(texts);
        this._play = new St.Button({
            style_class: 'm3-cm-play', width: px(64), height: px(44), can_focus: true, reactive: true,
        });
        this._playIcon = symbolIcon('play_arrow', {size: 26, filled: true, styleClass: 'm3-cm-play-icon'});
        this._play.set_child(centerBin(this._playIcon, 'm3-cm-inner'));
        pressFeedback(this._play);
        this._play.connect('clicked', () => this._backend.playPause());
        middle.add_child(this._play);
        body.add_child(middle);

        const controls = new St.BoxLayout({x_expand: true, style: `spacing: ${px(4)}px;`});
        this._previous = this._button('skip_previous', () => this._backend.previous());
        this._next = this._button('skip_next', () => this._backend.next());
        this._shuffle = this._button('shuffle', () => {
            this._backend.setShuffle(!(this._progress?.shuffle));
            if (this._progress)
                this._progress.shuffle = !this._progress.shuffle;
            this._paintShuffle();
        });
        controls.add_child(this._previous);
        controls.add_child(this._buildSeek());
        controls.add_child(this._next);
        controls.add_child(this._shuffle);
        body.add_child(controls);

        this._unsubscribe = backend.subscribe(() => this.sync());
        this.actor.connect('notify::mapped', () => this._poll());
        this.actor.connect('destroy', () => {
            this._unsubscribe();
            this._coverCancel?.cancel();
            if (this._timerId)
                GLib.source_remove(this._timerId);
            this._timerId = 0;
        });
        this.sync();
    }

    _button(name, onClick) {
        const button = new St.Button({
            style_class: 'm3-cm-btn', width: px(34), height: px(34), can_focus: true, reactive: true,
        });
        button.set_child(centerBin(symbolIcon(name, {size: 20, filled: true, styleClass: 'm3-cm-btn-icon'}), 'm3-cm-inner'));
        pressFeedback(button);
        button.connect('clicked', onClick);
        return button;
    }

    _buildSeek() {
        this._seek = new St.Widget({
            x_expand: true, height: px(34), reactive: true, layout_manager: new Clutter.FixedLayout(),
        });
        this._seekRest = new St.Widget({style_class: 'm3-cm-rest'});
        this._seekFill = new St.Widget({style_class: 'm3-cm-fill'});
        this._seekThumb = new St.Widget({style_class: 'm3-cm-thumb'});
        for (const a of [this._seekRest, this._seekFill, this._seekThumb])
            this._seek.add_child(a);
        this._seek.connect('notify::width', () => this._paintSeek());

        let dragging = false;
        const fractionAt = event => {
            const [x] = this._seek.transform_stage_point(...event.get_coords());
            return Math.max(0, Math.min(1, x / Math.max(1, this._seek.width)));
        };
        this._seek.connect('button-press-event', (_a, event) => {
            dragging = true;
            this._seekFraction = fractionAt(event);
            this._paintSeek();
            return Clutter.EVENT_STOP;
        });
        this._seek.connect('motion-event', (_a, event) => {
            if (dragging) {
                this._seekFraction = fractionAt(event);
                this._paintSeek();
            }
            return Clutter.EVENT_STOP;
        });
        const finish = () => {
            if (!dragging)
                return Clutter.EVENT_PROPAGATE;
            dragging = false;
            const p = this._progress;
            if (p && p.length > 0 && this._seekFraction !== null) {
                this._backend.seekBy(this._seekFraction * p.length - p.position);
                p.position = this._seekFraction * p.length;
            }
            this._seekFraction = null;
            this._paintSeek();
            return Clutter.EVENT_STOP;
        };
        this._seek.connect('button-release-event', finish);
        this._seek.connect('leave-event', finish);
        return this._seek;
    }

    _paintSeek() {
        const w = this._seek.width > 0 ? this._seek.width : px(150);
        const h = px(34);
        const p = this._progress;
        const fraction = this._seekFraction ??
            (p && p.length > 0 ? Math.max(0, Math.min(1, p.position / p.length)) : 0);
        const thumbW = px(3);
        const x = Math.round(fraction * (w - thumbW));
        const bar = px(4);
        const gap = px(4);
        const y = Math.round((h - bar) / 2);
        const fillW = Math.max(0, x - gap);
        const restX = x + thumbW + gap;
        this._seekFill.visible = fillW > 0;
        this._seekFill.set_position(0, y);
        this._seekFill.set_size(fillW, bar);
        this._seekFill.set_style(`border-radius: ${bar / 2}px;`);
        this._seekRest.set_position(restX, y);
        this._seekRest.set_size(Math.max(0, w - restX), bar);
        this._seekRest.set_style(`border-radius: ${bar / 2}px;`);
        this._seekThumb.set_position(x, Math.round((h - px(18)) / 2));
        this._seekThumb.set_size(thumbW, px(18));
        this._seekThumb.set_style(`border-radius: ${px(2)}px;`);
    }

    _paintShuffle() {
        if (this._progress?.shuffle)
            this._shuffle.add_style_pseudo_class('checked');
        else
            this._shuffle.remove_style_pseudo_class('checked');
    }

    /** Poll the position once a second while the card is on screen and playing. */
    _poll() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (!this.actor.mapped)
            return;
        const read = () => this._backend.progress().then(p => {
            if (!this.actor || this._seekFraction !== null)
                return;
            this._progress = p;
            this._paintSeek();
            this._paintShuffle();
        });
        read();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this._backend.state.playing)
                read();
            return GLib.SOURCE_CONTINUE;
        });
    }

    sync() {
        const state = this._backend.state;
        this._title.set_text(state.title ?? '');
        this._subtitle.set_text(state.subtitle ?? '');
        this._playIcon.set_text(state.playing ? 'pause' : 'play_arrow');
        for (const button of [this._previous, this._play, this._next, this._shuffle]) {
            button.reactive = state.available;
            button.opacity = state.available ? 255 : 110;
        }
        this._syncCover(state.coverUrl ?? '');
        if (this.actor.mapped)
            this._poll();
    }

    _syncCover(url) {
        if (url === this._coverUrl)
            return;
        this._coverUrl = url;
        this._coverCancel?.cancel();
        this._coverCancel = null;
        if (!url) {
            this.actor.set_style(null);
            return;
        }
        const cancel = new Gio.Cancellable();
        this._coverCancel = cancel;
        loadCover(url, px(CARD_W) * 2, cancel).then(path => {
            if (cancel.is_cancelled() || !path)
                return;
            const offset = Math.round((px(CARD_W) - px(CARD_H)) / 2);
            this.actor.set_style(
                `background-image: url("${GLib.filename_to_uri(path, null)}"); ` +
                `background-size: ${px(CARD_W)}px ${px(CARD_W)}px; background-position: 0px -${offset}px;`);
        }).catch(e => {
            if (!cancel.is_cancelled())
                console.error(`material3: could not load the cover: ${e.message}`);
        });
    }
}

/**
 * @param {object} backend * @returns {MediaCard}
 */
export function buildMediaCard(backend, {style = 'classic'} = {}) {
    return style === 'cover' ? new CoverMediaCard(backend) : new MediaCard(backend);
}
