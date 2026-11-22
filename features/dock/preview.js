import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from '../../i18n.js';
import {px, scoped} from '../quickSettings/ui.js';
import {centerBin, pressFeedback, symbolIcon, textLabel} from '../quickSettings/widgets.js';

const SHOW_DELAY = 280; // ms the pointer rests on an icon before the preview opens
const HIDE_DELAY = 220; // grace to move from the icon onto the preview
const THUMB_W = 200;
const THUMB_H = 125;
const PER_ROW = 4;

/**
 * Hover preview of an app's open windows, above its dock icon. Shown for
 * one window as well as for several (as the reference does).
 */
export class WindowPreview {
    /**
     * @param {object} host
     * @param {function(): boolean} host.blocked another popup is open
     * @param {function(boolean): void} host.openChanged
     * @param {function(): number} host.previewScale size factor of the thumbnails
     */
    constructor(host) {
        this._host = host;
        this.isOpen = false;
        this._item = null;
        this._showId = 0;
        this._hideId = 0;
        this._windows = [];

        // `m3-qs` (+ light/dark, set by the feature) puts the palette in scope.
        this.actor = new St.Widget({
            style_class: 'm3-qs',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            reactive: true,
        });
        this._panel = new St.BoxLayout({
            style_class: 'm3-prev',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            track_hover: true,
        });
        this._panel.set_pivot_point(0.5, 1);
        this.actor.add_child(this._panel);
        this._panel.connect('notify::hover', () => {
            if (this._panel.hover)
                this._cancel('_hideId');
            else
                this._scheduleHide();
        });
    }

    /** Pointer entered or left a dock icon. */
    hover(item, hovered) {
        if (hovered) {
            this._cancel('_hideId');
            if (this.isOpen && this._item === item)
                return;
            this._cancel('_showId');
            // Already open for another icon: switch at once.
            const delay = this.isOpen ? 0 : SHOW_DELAY;
            this._showId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._showId = 0;
                this._show(item);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._cancel('_showId');
            this._scheduleHide();
        }
    }

    _cancel(field) {
        if (this[field]) {
            GLib.source_remove(this[field]);
            this[field] = 0;
        }
    }

    _scheduleHide() {
        if (!this.isOpen || this._hideId)
            return;
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY, () => {
            this._hideId = 0;
            if (!this._panel.hover)
                this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _windowsOf(item) {
        return item.app.get_windows().filter(w => !w.skip_taskbar);
    }

    _show(item) {
        if (this._host.blocked() || !item.actor.mapped)
            return;
        const windows = this._windowsOf(item);
        if (windows.length === 0) {
            this.hide();
            return;
        }

        this._item = item;
        this._windows = windows;
        scoped('dock', () => this._rebuild());

        const wasOpen = this.isOpen;
        this.isOpen = true;
        this.actor.show();
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this._place();
        if (!wasOpen)
            this._host.openChanged(true);

        this._panel.remove_all_transitions();
        if (!wasOpen) {
            this._panel.set_scale(0.96, 0.96);
            this._panel.translation_y = px(8);
            this._panel.opacity = 0;
        }
        this._panel.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            translation_y: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    /** Centered over the icon, just above the dock, kept on the monitor. */
    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        const [ix, iy] = this._item.actor.get_transformed_position();
        const [iw] = this._item.actor.get_transformed_size();
        const [, width] = this._panel.get_preferred_width(-1);
        const [, height] = this._panel.get_preferred_height(width);
        const margin = px(12);
        const x = Math.max(monitor.x + margin,
            Math.min(ix + iw / 2 - width / 2, monitor.x + monitor.width - width - margin));
        const y = Math.max(monitor.y + margin, iy - px(14) - height);
        this.actor.set_position(Math.round(x), Math.round(y));
    }

    _rebuild() {
        this._panel.destroy_all_children();

        const perRow = this._windows.length > 2 ? 2 : PER_ROW;
        let row = null;
        this._windows.forEach((window, index) => {
            // Three or more windows make a grid of two columns.
            if (index % perRow === 0) {
                row = new St.BoxLayout({style: `spacing: ${px(8)}px;`});
                this._panel.add_child(row);
            }
            row.add_child(this._card(window));
        });
    }

    _card(window) {
        const k = this._host.previewScale?.() ?? 1;
        const maxW = Math.round(px(THUMB_W) * k);
        const maxH = Math.round(px(THUMB_H) * k);
        const actor = window.get_compositor_private();
        let tw = maxW;
        let th = maxH;
        let scale = 1;
        if (actor) {
            const [aw, ah] = actor.get_size();
            if (aw > 0 && ah > 0) {
                scale = Math.min(maxW / aw, maxH / ah);
                tw = Math.max(1, Math.round(aw * scale));
                th = Math.max(1, Math.round(ah * scale));
            }
        }

        const card = new St.Button({
            style_class: 'm3-prev-card',
            accessible_name: window.get_title() ?? '',
            can_focus: true,
            reactive: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${px(6)}px;`,
        });

        const head = new St.BoxLayout({width: tw, style: `spacing: ${px(6)}px;`});
        head.add_child(new St.Icon({gicon: this._item.app.get_icon(), icon_size: px(16),
            y_align: Clutter.ActorAlign.CENTER}));
        const title = textLabel(window.get_title() || this._item.app.get_name(), 'm3-prev-title',
            {x_expand: true});
        title.set_style(`max-width: ${Math.round(px(THUMB_W - 54) * k)}px;`);
        title.clutter_text.set_single_line_mode(true);
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        head.add_child(title);

        const close = new St.Button({
            style_class: 'm3-prev-close',
            accessible_name: _('Close'),
            width: px(22),
            height: px(22),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: centerBin(symbolIcon('close', {size: 14}), 'm3-prev-close-inner'),
        });
        pressFeedback(close);
        close.connect('clicked', () => {
            window.delete(global.get_current_time());
            // The window takes a moment to go away; drop its card now.
            this._windows = this._windows.filter(w => w !== window);
            if (this._windows.length === 0) {
                this.hide();
            } else {
                scoped('dock', () => this._rebuild());
                this._place();
            }
        });
        head.add_child(close);
        box.add_child(head);

        const thumb = new St.Widget({
            style_class: 'm3-prev-thumb',
            layout_manager: new Clutter.FixedLayout(),
            width: tw,
            height: th,
            clip_to_allocation: true,
        });
        if (actor) {
            const clone = new Clutter.Clone({source: actor});
            clone.set_pivot_point(0, 0);
            clone.set_scale(scale, scale);
            thumb.add_child(clone);
        }
        box.add_child(thumb);
        card.set_child(box);

        card.connect('clicked', (_button, which) => {
            if (which === 2) {
                close.emit('clicked', 1);
                return;
            }
            this.hide(false);
            Main.activateWindow(window);
        });
        return card;
    }

    hide(animate = true) {
        this._cancel('_showId');
        this._cancel('_hideId');
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this._item = null;
        this._host.openChanged(false);

        this._panel.remove_all_transitions();
        if (!animate) {
            this.actor.hide();
            return;
        }
        this._panel.ease({
            opacity: 0,
            translation_y: px(6),
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this.isOpen)
                    this.actor.hide();
            },
        });
    }

    setDark(dark) {
        this.actor.remove_style_class_name('m3-light');
        this.actor.remove_style_class_name('m3-dark');
        this.actor.add_style_class_name(dark ? 'm3-dark' : 'm3-light');
    }

    destroy() {
        this._cancel('_showId');
        this._cancel('_hideId');
        this.isOpen = false;
        this.actor.destroy();
    }
}
