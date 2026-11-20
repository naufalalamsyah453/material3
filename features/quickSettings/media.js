import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {loadCover} from './cover.js';

import {px} from './ui.js';
import {pressFeedback, symbolIcon, truncatedLabel} from './widgets.js';

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

/**
 * @param {object} backend
 * @returns {MediaCard}
 */
export function buildMediaCard(backend) {
    return new MediaCard(backend);
}
