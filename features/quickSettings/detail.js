import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {_} from '../../i18n.js';
import {Ease, lerp, tweenerFor} from './animation.js';
import {px} from './ui.js';
import {iconButton, pressFeedback, symbolIcon, textLabel, truncatedLabel} from './widgets.js';

const ROW_HEIGHT = 44;
const TEXT_WIDTH = 190;
const PADDING = 25;
// The panel's own padding; the pane reaches over it to the panel's inner edge.
const OUTSET = 15;
const HEADER_HEIGHT = 32;
const SPACING = 8;
// Gap between the rows of the list (its inline `spacing` style).
const LIST_SPACING = 6;

/**
 * Pop-up that covers the tile grid and lists the options of one tile
 * (Wi-Fi networks, Bluetooth devices, power modes).
 *
 * A provider is `{title, icon, getOptions(), subscribe(cb), onOpen?(), settingsPage?}`;
 * getOptions() returns `{items, emptyText}` where an item is
 * `{id, icon, label, sublabel, selected, trailing, activate(), closeOnActivate}`.
 * The list re-renders whenever the provider notifies.
 */
export class DetailPane {
    /**
     * @param {object} params
     * @param {function(): {width: number, height: number}} params.getSize
     *   size of the surface the pane must cover, read each time it opens
     */
    constructor({getSize, openSettings}) {
        this._getSize = getSize;
        this._openSettings = openSettings;
        this._provider = null;
        this._unsubscribe = null;
        this._t = 0;
        this._closing = false;
        this._rowCount = 0;

        this.actor = new St.BoxLayout({
            style_class: 'm3-detail',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            reactive: true,
            visible: false,
            opacity: 0,
            style: `spacing: ${px(8)}px;`,
        });
        this.actor.set_pivot_point(0.5, 0.5);
        this._tweener = tweenerFor(this.actor);

        const header = new St.BoxLayout({height: px(HEADER_HEIGHT), style: `spacing: ${px(8)}px;`});
        this._back = iconButton('arrow_back', {size: 18, buttonSize: HEADER_HEIGHT});
        this._back.connect('clicked', () => this.close());
        header.add_child(this._back);

        this._headerIcon = symbolIcon('wifi', {size: 18, filled: true, styleClass: 'm3-opt-icon'});
        header.add_child(this._headerIcon);
        this._title = textLabel('', 'm3-detail-title', {x_expand: true});
        header.add_child(this._title);
        // On/off switch of the tile this pane belongs to (Wi-Fi, Bluetooth).
        this._switch = this._buildSwitch();
        header.add_child(this._switch);
        // Gear: the matching page of the extension's Settings app.
        this._gear = iconButton('settings', {size: 18, buttonSize: HEADER_HEIGHT});
        this._gear.accessible_name = _('Settings');
        this._gear.connect('clicked', () => {
            const page = this._provider?.settingsPage;
            if (page)
                this._openSettings?.(page);
        });
        header.add_child(this._gear);
        this.actor.add_child(header);

        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            // EXTERNAL: no scrollbar drawn, wheel/touch scrolling still works.
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: `spacing: ${px(LIST_SPACING)}px;`,
        });
        this._scroll.set_child(this._list);
        this.actor.add_child(this._scroll);

        this.actor.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('destroy', () => this._unsubscribe?.());
    }

    _buildSwitch() {
        const W = 52;
        const H = 32;
        const button = new St.Button({
            style_class: 'm3-switch',
            can_focus: true,
            reactive: true,
            track_hover: true,
            width: px(W),
            height: px(H),
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        const track = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        const thumb = new St.Widget({
            style_class: 'm3-switch-thumb',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        track.add_child(thumb);
        button.set_child(track);
        button.connect('clicked', () => this._provider?.toggle?.());

        // Off: small thumb at the left (6px in); on: large thumb 4px from the right.
        // The thumb always sits at the left; the move is a translation.
        const inner = W - 4;
        thumb.set_style(`margin-left: ${px(6)}px;`);
        button._set = (on, animate) => {
            const d = on ? 24 : 16;
            const shift = on ? inner - 24 - 4 - 6 : 0;
            thumb.set_size(px(d), px(d));
            if (animate && thumb.mapped) {
                thumb.ease({translation_x: px(shift), duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            } else {
                thumb.translation_x = px(shift);
            }
            if (on)
                button.add_style_class_name('active');
            else
                button.remove_style_class_name('active');
        };
        button._on = null;
        return button;
    }

    _syncSwitch(animate) {
        const state = this._provider?.getState?.();
        const has = !!state && !!this._provider?.toggle;
        this._switch.visible = has;
        if (!has)
            return;
        this._switch.reactive = state.available !== false;
        this._switch.opacity = state.available !== false ? 255 : 128;
        if (this._switch._on !== state.active) {
            this._switch._on = state.active;
            this._switch._set(state.active, animate && this._switch._on !== null);
        }
    }

    get isOpen() {
        return this._provider !== null && !this._closing;
    }

    /** @param {object} provider */
    open(provider) {
        this._unsubscribe?.();
        this._provider = provider;
        this._closing = false;

        this._headerIcon.set_text(provider.icon);
        this._title.set_text(provider.title);
        this._gear.visible = !!provider.settingsPage;
        this._switch._on = null;
        this._syncSwitch(false);
        this._unsubscribe = provider.subscribe(() => this._render());
        provider.onOpen?.();
        this._render();

        this.actor.show();
        this._animate(1);
        this._back.grab_key_focus();
    }

    /**
     * Cover the whole surface; with `provider.fitContent` only as tall as the
     * header and the options need (never taller than the surface).
     */
    _fit() {
        const {width, height} = this._getSize();
        if (width <= 0 || height <= 0)
            return;
        const outset = px(OUTSET);
        const fullHeight = height + outset * 2;
        const chrome = px(PADDING) * 2 + px(HEADER_HEIGHT) + px(SPACING);
        let scrollHeight = Math.max(0, fullHeight - chrome);

        if (this._provider?.fitContent)
            scrollHeight = Math.min(scrollHeight, this._contentHeight());

        this.actor.set_size(width + outset * 2, scrollHeight + chrome);
        this.actor.set_position(-outset, -outset);
        this._scroll.height = scrollHeight;
    }

    /**
     * Height of the list. The rows have a fixed height, so it is computed
     * from them: measuring the list right after it was filled can happen
     * before its inline spacing is styled (the first time the pane opens),
     * which left the last row cut off.
     */
    _contentHeight() {
        const rows = this._rowCount;
        if (rows > 0)
            return rows * px(ROW_HEIGHT) + (rows - 1) * px(LIST_SPACING);

        this._list.ensure_style();
        const [, height] = this._list.get_preferred_height(-1);
        return height;
    }

    /** @param {boolean} [animate] */
    close(animate = true) {
        if (!this._provider)
            return;

        this._unsubscribe?.();
        this._unsubscribe = null;
        this._provider = null;
        this._closing = true;

        this._animate(0, animate ? 200 : 0);
    }

    _animate(target, duration = 260) {
        this._tweener.run('visibility', {
            from: this._t,
            to: target,
            duration,
            ease: Ease.spring,
            onUpdate: t => {
                this._t = t;
                this.actor.opacity = Math.round(Math.max(0, Math.min(1, t)) * 255);
                const scale = lerp(0.94, 1, t);
                this.actor.set_scale(scale, scale);
            },
            onComplete: () => {
                if (target === 0) {
                    this.actor.hide();
                    this._closing = false;
                }
            },
        });
    }

    _render() {
        if (!this._provider)
            return;

        this._syncSwitch(true);
        const adjustment = this._scroll.vadjustment;
        const scrollTop = adjustment.value;

        this._list.destroy_all_children();
        const {items, emptyText} = this._provider.getOptions();
        this._rowCount = items.length;

        if (items.length === 0) {
            this._list.add_child(textLabel(emptyText ?? '', 'm3-detail-empty', {
                x_align: Clutter.ActorAlign.CENTER,
                style: `padding-top: ${px(24)}px;`,
            }));
            this._fit();
            return;
        }

        for (const item of items)
            this._list.add_child(this._row(item));

        this._fit();
        adjustment.value = scrollTop;
    }

    _row(item) {
        const button = new St.Button({
            style_class: `m3-opt ${item.selected ? 'm3-opt-selected' : ''}`.trim(),
            height: px(ROW_HEIGHT),
            x_expand: true,
            can_focus: true,
            reactive: true,
        });
        pressFeedback(button, {scale: 0.97});

        const row = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(10)}px;`,
        });
        row.add_child(symbolIcon(item.icon, {size: 20, filled: item.selected, styleClass: 'm3-opt-icon'}));

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        text.add_child(truncatedLabel(item.label, 'm3-opt-label', TEXT_WIDTH));
        if (item.sublabel)
            text.add_child(truncatedLabel(item.sublabel, 'm3-opt-sub', TEXT_WIDTH));
        row.add_child(text);

        const trailing = item.selected ? 'check' : item.trailing;
        if (trailing)
            row.add_child(symbolIcon(trailing, {size: 18, styleClass: 'm3-opt-icon'}));

        button.set_child(row);
        button.connect('clicked', () => {
            item.activate?.();
            if (item.closeOnActivate)
                this.close();
        });
        return button;
    }
}
