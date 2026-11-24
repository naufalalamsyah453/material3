import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WeatherClient} from 'resource:///org/gnome/shell/misc/weather.js';

import {_} from '../../i18n.js';
import {px} from '../quickSettings/ui.js';
import {centerBin, iconButton, pressFeedback, symbolIcon, textLabel as baseLabel} from '../quickSettings/widgets.js';

// Size of the whole panel and of its text (settings datemenu-scale / datemenu-font-scale).
const dm = {scale: 1, text: 1};
const sx = value => Math.round(px(value) * dm.scale);

// Font sizes of the stylesheet's `.m3-dm-*` text rules, scaled inline by the text setting.
const FONT = {
    'm3-dm-weekday': 15, 'm3-dm-fulldate': 26, 'm3-dm-title': 14, 'm3-dm-muted': 12,
    'm3-dm-notif-source': 14, 'm3-dm-notif-title': 14, 'm3-dm-notif-body': 13,
    'm3-dm-btn-text': 14, 'm3-dm-month-text': 15, 'm3-dm-chip': 11, 'm3-dm-day-text': 13,
    'm3-dm-note-text': 12, 'm3-dm-clock-name': 14, 'm3-dm-clock-time': 14,
    'm3-dm-badge-text': 11, 'm3-dm-temp': 18,
};

function textLabel(text, styleClass, params = {}) {
    const label = baseLabel(text, styleClass, params);
    const key = styleClass.split(' ').find(c => FONT[c]);
    if (key)
        label.set_style(`font-size: ${Math.round(FONT[key] * dm.scale * dm.text * 10) / 10}px;`);
    return label;
}

const LEFT_WIDTH = 440;
const RIGHT_WIDTH = 340;
const NOTES_KEY = 'datemenu-notes';

const longDate = new Intl.DateTimeFormat(undefined, {month: 'long', day: 'numeric', year: 'numeric'});
const weekday = new Intl.DateTimeFormat(undefined, {weekday: 'long'});
const monthName = new Intl.DateTimeFormat(undefined, {month: 'long'});
const monthYear = new Intl.DateTimeFormat(undefined, {month: 'long', year: 'numeric'});

const dayKey = (y, m, d) => `${y}-${m}-${d}`;

/** A pill-shaped St.Button with a text label. */
function pillButton(text, styleClass, onClick) {
    const button = new St.Button({
        style_class: `m3-dm-btn ${styleClass}`.trim(),
        can_focus: true,
        reactive: true,
        child: textLabel(text, 'm3-dm-btn-text'),
    });
    pressFeedback(button);
    button.connect('clicked', onClick);
    return button;
}

/**
 * The date menu of the Android 17 reference: notifications on the left,
 * and on the right the date, a month calendar, reminders, world clocks and
 * the weather. It is shown inside the shell's own date menu, so it opens
 * from the same panel button.
 */
class DatePanel {
    /** @param {Gio.Settings} settings the extension's settings (reminders live there) */
    constructor(settings, onClose) {
        this._settings = settings;
        this._onClose = onClose;
        const has = key => settings.settings_schema.has_key(key);
        dm.scale = has('datemenu-scale') ? Math.max(0.7, Math.min(1.5, settings.get_double('datemenu-scale'))) : 1;
        dm.text = has('datemenu-font-scale') ? Math.max(0.7, Math.min(1.5, settings.get_double('datemenu-font-scale'))) : 1;
        this._today = new Date();
        this._selected = {y: this._today.getFullYear(), m: this._today.getMonth(), d: this._today.getDate()};
        this._view = {y: this._selected.y, m: this._selected.m};
        this._notes = this._loadNotes();
        this._sources = new Map();
        this._clocks = [];
        this._timerId = 0;

        // The outer actor carries the palette scope (`m3-qs`); every rule is scoped under it.
        this.actor = new St.Bin({style_class: 'm3-qs'});
        this._root = new St.BoxLayout({
            style_class: 'm3-dm-root',
            style: `spacing: ${sx(20)}px; padding: ${sx(22)}px;`,
        });
        this.actor.set_child(this._root);
        this._buildNotifications();
        this._root.add_child(new St.Widget({style_class: 'm3-dm-sep', width: sx(1)}));
        this._buildSide();
    }

    // ---- notifications (left) -------------------------------------------------

    _buildNotifications() {
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: sx(LEFT_WIDTH),
            style: `spacing: ${sx(12)}px;`,
        });
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: `spacing: ${sx(10)}px;`});
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            clip_to_allocation: true,
            y_expand: true,
            style: `min-height: ${sx(380)}px; max-height: ${sx(520)}px;`,
        });
        this._scroll.add_child(this._list);
        column.add_child(this._scroll);

        this._empty = new St.BoxLayout({
            style_class: 'm3-dm-empty',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        const emptyIcon = symbolIcon('notifications_off', {size: 28, styleClass: 'm3-dm-muted'});
        emptyIcon.x_align = Clutter.ActorAlign.CENTER;
        this._empty.add_child(emptyIcon);
        const emptyText = textLabel(_('No new notifications'), 'm3-dm-muted', {x_align: Clutter.ActorAlign.CENTER});
        this._empty.add_child(emptyText);
        column.add_child(this._empty);

        const bar = new St.BoxLayout();
        this._clear = new St.Button({
            style_class: 'm3-dm-btn m3-dm-clear',
            can_focus: true,
            reactive: true,
        });
        const clearRow = new St.BoxLayout({style: `spacing: ${sx(8)}px;`});
        clearRow.add_child(symbolIcon('clear_all', {size: 18, filled: true, styleClass: 'm3-dm-btn-text'}));
        clearRow.add_child(textLabel(_('Clear'), 'm3-dm-btn-text'));
        this._clear.set_child(clearRow);
        pressFeedback(this._clear);
        this._clear.connect('clicked', () => this._clearAll());
        bar.add_child(this._clear);
        column.add_child(bar);
        this._root.add_child(column);
    }

    _notifications() {
        const all = [];
        for (const source of Main.messageTray.getSources?.() ?? []) {
            for (const notification of source.notifications ?? [])
                all.push({source, notification});
        }
        all.sort((a, b) => (b.notification.datetime?.to_unix?.() ?? 0) - (a.notification.datetime?.to_unix?.() ?? 0));
        return all;
    }

    _renderNotifications() {
        this._list.destroy_all_children();
        const items = this._notifications();
        for (const {source, notification} of items)
            this._list.add_child(this._notificationCard(source, notification));
        const none = items.length === 0;
        this._scroll.visible = !none;
        this._empty.visible = none;
        this._clear.visible = !none;
    }

    _notificationCard(source, notification) {
        const card = new St.Button({
            style_class: 'm3-dm-card m3-dm-notif',
            can_focus: true,
            reactive: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            button_mask: St.ButtonMask.ONE,
            style: `padding: ${sx(12)}px ${sx(14)}px; border-radius: ${sx(24)}px;`,
        });
        // A button centers its child at natural width; the content must fill the card.
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.FILL,
            style: `spacing: ${sx(6)}px;`,
        });

        const head = new St.BoxLayout({x_expand: true, style: `spacing: ${sx(10)}px;`});
        const badge = new St.Bin({
            style_class: 'm3-dm-badge-icon', width: sx(34), height: sx(34), y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: ${sx(12)}px;`,
        });
        const gicon = source.icon ?? notification.gicon;
        badge.set_child(gicon
            ? new St.Icon({gicon, icon_size: sx(18)})
            : symbolIcon('notifications', {size: 18, filled: true}));
        head.add_child(badge);
        head.add_child(textLabel(source.title ?? '', 'm3-dm-notif-source', {x_expand: true}));
        const stamp = notification.datetime;
        head.add_child(textLabel(this._relative(stamp), 'm3-dm-muted'));
        const dismiss = new St.Button({
            style_class: 'm3-dm-circle', width: sx(30), height: sx(30), can_focus: true, reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: centerBin(symbolIcon('close', {size: 16, filled: true}), 'm3-dm-circle-inner'),
        });
        pressFeedback(dismiss);
        dismiss.connect('clicked', () => notification.destroy());
        head.add_child(dismiss);
        box.add_child(head);

        const title = textLabel(notification.title ?? '', 'm3-dm-notif-title', {x_expand: true, x_align: Clutter.ActorAlign.FILL});
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        box.add_child(title);
        if (notification.body) {
            const body = textLabel(notification.body, 'm3-dm-notif-body', {x_expand: true, x_align: Clutter.ActorAlign.FILL});
            body.clutter_text.set_line_wrap(true);
            body.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            body.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            body.clutter_text.set_single_line_mode(false);
            box.add_child(body);
        }
        card.set_child(box);
        card.connect('clicked', () => {
            try {
                notification.activate();
            } catch (e) {
                console.error(`material3: cannot activate the notification: ${e.message}`);
                return;
            }
            this._onClose();
        });
        return card;
    }

    _relative(stamp) {
        if (!stamp)
            return '';
        const seconds = GLib.DateTime.new_now_local().to_unix() - stamp.to_unix();
        if (seconds < 60)
            return _('Just now');
        return stamp.to_local().format('%H:%M');
    }

    _clearAll() {
        for (const {notification} of this._notifications())
            notification.destroy();
        this._renderNotifications();
    }

    // ---- date, calendar, reminders, clocks, weather (right) --------------------

    _buildSide() {
        const side = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: sx(RIGHT_WIDTH),
            style: `spacing: ${sx(12)}px;`,
        });

        const head = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: `padding: 0 ${sx(4)}px;`});
        this._weekdayLabel = textLabel('', 'm3-dm-weekday');
        this._dateLabel = textLabel('', 'm3-dm-fulldate');
        head.add_child(this._weekdayLabel);
        head.add_child(this._dateLabel);
        side.add_child(head);

        side.add_child(this._buildCalendar());
        side.add_child(this._buildEvents());
        side.add_child(this._buildClocks());
        side.add_child(this._buildWeather());
        this._root.add_child(side);
    }

    _buildCalendar() {
        const card = new St.BoxLayout({
            style_class: 'm3-dm-card m3-dm-calendar',
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${sx(8)}px;`,
        });

        const nav = new St.BoxLayout({style: `spacing: ${sx(8)}px;`});
        const prev = iconButton('chevron_left', {size: 20, styleClass: 'm3-dm-circle', buttonSize: 36});
        prev.connect('clicked', () => this._shiftMonth(-1));
        this._monthButton = new St.Button({
            style_class: 'm3-dm-btn m3-dm-month', can_focus: true, reactive: true, x_expand: true,
        });
        this._monthButton.connect('clicked', () => this._goToday());
        pressFeedback(this._monthButton);
        const next = iconButton('chevron_right', {size: 20, styleClass: 'm3-dm-circle', buttonSize: 36});
        next.connect('clicked', () => this._shiftMonth(1));
        nav.add_child(prev);
        nav.add_child(this._monthButton);
        nav.add_child(next);
        card.add_child(nav);

        const layout = new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: sx(4),
            row_spacing: sx(6),
        });
        this._grid = new St.Widget({layout_manager: layout, x_expand: true});
        card.add_child(this._grid);
        return card;
    }

    _renderCalendar() {
        const {y, m} = this._view;
        const sameYear = y === this._today.getFullYear();
        this._monthButton.set_child(textLabel(
            (sameYear ? monthName : monthYear).format(new Date(y, m, 1)), 'm3-dm-month-text',
            {x_align: Clutter.ActorAlign.CENTER, x_expand: true}));

        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        const start = Shell.util_get_week_start();

        // Weekday chips (the first one is the locale's week start).
        const sunday = new Date(2023, 0, 1);
        for (let i = 0; i < 7; i++) {
            const name = new Intl.DateTimeFormat(undefined, {weekday: 'narrow'})
                .format(new Date(sunday.getFullYear(), 0, 1 + ((start + i) % 7)));
            layout.attach(textLabel(name, 'm3-dm-chip', {x_align: Clutter.ActorAlign.FILL}), i, 0, 1, 1);
        }

        const first = (new Date(y, m, 1).getDay() - start + 7) % 7;
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        for (let i = 0; i < 42; i++) {
            const date = new Date(y, m, 1 - first + i);
            const outside = date.getMonth() !== m;
            const selected = date.getFullYear() === this._selected.y &&
                date.getMonth() === this._selected.m && date.getDate() === this._selected.d;
            const isToday = date.getFullYear() === this._today.getFullYear() &&
                date.getMonth() === this._today.getMonth() && date.getDate() === this._today.getDate();
            const hasNote = (this._notes[dayKey(date.getFullYear(), date.getMonth(), date.getDate())] ?? []).length > 0;

            let classes = 'm3-dm-day';
            if (outside)
                classes += ' m3-dm-day-out';
            if (isToday && !selected)
                classes += ' m3-dm-day-today';
            const button = new St.Button({
                style_class: classes,
                width: sx(38),
                height: sx(38),
                can_focus: true,
                reactive: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (selected) {
                // The selected day turns from a circle into a rounded square.
                button.add_style_class_name('m3-dm-day-selected');
                button.set_style(`border-radius: ${sx(14)}px;`);
            }
            const inner = new St.Widget({layout_manager: new Clutter.BinLayout()});
            inner.add_child(textLabel(String(date.getDate()).padStart(2, '0'), 'm3-dm-day-text',
                {x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true}));
            if (hasNote && !selected) {
                inner.add_child(new St.Widget({
                    style_class: 'm3-dm-dot', width: sx(4), height: sx(4),
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.END,
                    x_expand: true, y_expand: true, style: `margin-bottom: ${sx(3)}px;`,
                }));
            }
            button.set_child(inner);
            pressFeedback(button);
            button.connect('clicked', () => this._select(date));
            layout.attach(button, i % 7, 1 + Math.floor(i / 7), 1, 1);
        }
        void daysInMonth;
    }

    _select(date) {
        this._selected = {y: date.getFullYear(), m: date.getMonth(), d: date.getDate()};
        this._view = {y: this._selected.y, m: this._selected.m};
        this._refreshDate();
    }

    _shiftMonth(delta) {
        const date = new Date(this._view.y, this._view.m + delta, 1);
        this._view = {y: date.getFullYear(), m: date.getMonth()};
        this._renderCalendar();
    }

    _goToday() {
        this._today = new Date();
        this._select(this._today);
    }

    _refreshDate() {
        const date = new Date(this._selected.y, this._selected.m, this._selected.d);
        this._weekdayLabel.set_text(weekday.format(date));
        this._dateLabel.set_text(longDate.format(date));
        const isToday = date.toDateString() === this._today.toDateString();
        this._eventsTitle?.set_text(isToday ? _('Today') : new Intl.DateTimeFormat(undefined,
            {month: 'short', day: 'numeric'}).format(date));
        this._renderCalendar();
        this._renderNotes();
    }

    // ---- reminders ----------------------------------------------------------------

    _loadNotes() {
        try {
            if (this._settings.settings_schema.has_key(NOTES_KEY))
                return JSON.parse(this._settings.get_string(NOTES_KEY) || '{}');
        } catch (e) {
            console.error(`material3: reminders could not be read: ${e.message}`);
        }
        return {};
    }

    _saveNotes() {
        try {
            if (this._settings.settings_schema.has_key(NOTES_KEY))
                this._settings.set_string(NOTES_KEY, JSON.stringify(this._notes));
        } catch (e) {
            console.error(`material3: reminders could not be saved: ${e.message}`);
        }
    }

    _buildEvents() {
        const card = new St.BoxLayout({
            style_class: 'm3-dm-card',
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${sx(6)}px;`,
        });
        const head = new St.BoxLayout();
        this._eventsTitle = textLabel(_('Today'), 'm3-dm-title', {x_expand: true});
        head.add_child(this._eventsTitle);
        this._addIcon = symbolIcon('add', {size: 19, filled: true, styleClass: 'm3-dm-accent'});
        this._addButton = new St.Button({
            style_class: 'm3-dm-circle m3-dm-add', width: sx(30), height: sx(30), can_focus: true, reactive: true,
            child: centerBin(this._addIcon, 'm3-dm-circle-inner'),
        });
        pressFeedback(this._addButton);
        this._addButton.connect('clicked', () => this._toggleInput());
        head.add_child(this._addButton);
        card.add_child(head);

        this._inputRow = new St.BoxLayout({visible: false, style: `spacing: ${sx(8)}px;`});
        this._entry = new St.Entry({
            style_class: 'm3-dm-entry', hint_text: _('Add reminder...'), can_focus: true, x_expand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._saveNote());
        this._inputRow.add_child(this._entry);
        this._inputRow.add_child(pillButton(_('Save'), 'm3-dm-save', () => this._saveNote()));
        card.add_child(this._inputRow);

        this._notesBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: `spacing: ${sx(6)}px;`});
        card.add_child(this._notesBox);
        return card;
    }

    _toggleInput() {
        const show = !this._inputRow.visible;
        this._inputRow.visible = show;
        this._addIcon.set_text(show ? 'close' : 'add');
        if (show)
            this._entry.grab_key_focus();
    }

    _saveNote() {
        const text = this._entry.get_text().trim();
        if (!text)
            return;
        const key = dayKey(this._selected.y, this._selected.m, this._selected.d);
        (this._notes[key] ??= []).push(text);
        this._saveNotes();
        this._entry.set_text('');
        this._toggleInput();
        this._refreshDate();
    }

    _renderNotes() {
        this._notesBox.destroy_all_children();
        const key = dayKey(this._selected.y, this._selected.m, this._selected.d);
        const items = this._notes[key] ?? [];
        if (items.length === 0) {
            this._notesBox.add_child(textLabel(_('No Events'), 'm3-dm-muted m3-dm-italic'));
            return;
        }
        items.forEach((text, index) => {
            const row = new St.BoxLayout({style_class: 'm3-dm-note', style: `spacing: ${sx(8)}px;`});
            const label = textLabel(text, 'm3-dm-note-text', {x_expand: true});
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            row.add_child(label);
            const remove = new St.Button({
                style_class: 'm3-dm-circle', width: sx(22), height: sx(22), can_focus: true, reactive: true,
                child: centerBin(symbolIcon('close', {size: 14}), 'm3-dm-circle-inner'),
            });
            remove.connect('clicked', () => {
                items.splice(index, 1);
                if (items.length === 0)
                    delete this._notes[key];
                this._saveNotes();
                this._refreshDate();
            });
            row.add_child(remove);
            this._notesBox.add_child(row);
        });
    }

    // ---- world clocks ---------------------------------------------------------------

    _buildClocks() {
        const card = new St.BoxLayout({
            style_class: 'm3-dm-card',
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${sx(6)}px;`,
        });
        const head = new St.BoxLayout();
        head.add_child(textLabel(_('World Clocks'), 'm3-dm-title', {x_expand: true}));
        head.add_child(symbolIcon('public', {size: 18, styleClass: 'm3-dm-muted'}));
        card.add_child(head);
        this._clockRows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: `spacing: ${sx(4)}px;`});
        card.add_child(this._clockRows);
        this._clocksCard = card;
        return card;
    }

    /** Places from GNOME Clocks, read through GWeather as the shell does. */
    async _loadClocks() {
        this._clocks = [];
        try {
            const {default: GWeather} = await import('gi://GWeather?version=4.0');
            const settings = new Gio.Settings({schema_id: 'org.gnome.shell.world-clocks'});
            for (const variant of settings.get_value('locations').deepUnpack()) {
                const location = GWeather.Location.deserialize(variant.deepUnpack?.() ?? variant);
                if (!location)
                    continue;
                const zone = location.get_timezone?.() ?? null;
                if (zone)
                    this._clocks.push({name: location.get_city_name?.() || location.get_name(), zone});
            }
        } catch (e) {
            console.error(`material3: world clocks unavailable: ${e.message}`);
        }
        this._renderClocks();
    }

    _renderClocks() {
        this._clockRows.destroy_all_children();
        this._clocksCard.visible = this._clocks.length > 0;
        const local = GLib.DateTime.new_now_local();
        for (const {name, zone} of this._clocks) {
            const there = GLib.DateTime.new_now(zone);
            const hours = Math.round((there.get_utc_offset() - local.get_utc_offset()) / 3600000000);
            const row = new St.BoxLayout();
            row.add_child(textLabel(name, 'm3-dm-clock-name', {x_expand: true}));
            row.add_child(textLabel(there.format('%-I:%M %p') ?? '', 'm3-dm-clock-time'));
            const offset = hours === 0 ? '0' : `${hours > 0 ? '+' : ''}${hours}`;
            row.add_child(new St.Bin({
                style_class: 'm3-dm-badge', y_align: Clutter.ActorAlign.CENTER,
                child: textLabel(offset, 'm3-dm-badge-text'),
            }));
            this._clockRows.add_child(row);
        }
    }

    // ---- weather ----------------------------------------------------------------------

    _buildWeather() {
        this._weatherButton = new St.Button({
            style_class: 'm3-dm-card m3-dm-weather', can_focus: true, reactive: true, x_expand: true,
        });
        const row = new St.BoxLayout({style: `spacing: ${sx(10)}px;`});
        this._weatherIcon = symbolIcon('location_on', {size: 20, filled: true, styleClass: 'm3-dm-accent'});
        row.add_child(this._weatherIcon);
        const texts = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._weatherTitle = textLabel(_('Select Weather Location...'), 'm3-dm-title');
        this._weatherSub = textLabel('', 'm3-dm-muted');
        this._weatherSub.visible = false;
        texts.add_child(this._weatherTitle);
        texts.add_child(this._weatherSub);
        row.add_child(texts);
        this._weatherTemp = textLabel('', 'm3-dm-temp');
        row.add_child(this._weatherTemp);
        this._weatherButton.set_child(row);
        pressFeedback(this._weatherButton);
        this._weatherButton.connect('clicked', () => {
            this._onClose();
            this._weather?.activateApp?.();
        });

        try {
            this._weather = new WeatherClient();
            this._weatherId = this._weather.connect('changed', () => this._renderWeather());
        } catch (e) {
            console.error(`material3: weather unavailable: ${e.message}`);
            this._weather = null;
        }
        this._renderWeather();
        return this._weatherButton;
    }

    _renderWeather() {
        const client = this._weather;
        this._weatherButton.visible = !!client?.available;
        if (!client?.available)
            return;
        if (!client.hasLocation || !client.info) {
            this._weatherTitle.set_text(_('Select Weather Location...'));
            this._weatherSub.visible = false;
            this._weatherTemp.set_text('');
            this._weatherIcon.set_text('location_on');
            return;
        }
        const info = client.info;
        this._weatherTitle.set_text(info.get_location_name?.() ?? '');
        const conditions = info.get_conditions?.() ?? '';
        this._weatherSub.set_text(conditions);
        this._weatherSub.visible = conditions !== '';
        this._weatherTemp.set_text(info.get_temp_summary?.() ?? '');
        this._weatherIcon.set_text('partly_cloudy_day');
    }

    // ---- lifecycle ------------------------------------------------------------------------

    /** Call each time the menu opens: fresh date, notifications and clocks. */
    open() {
        this._today = new Date();
        this._selected = {y: this._today.getFullYear(), m: this._today.getMonth(), d: this._today.getDate()};
        this._view = {y: this._selected.y, m: this._selected.m};
        this._notes = this._loadNotes();
        this._refreshDate();
        this._renderNotifications();
        this._loadClocks();
        this._weather?.update?.();

        for (const source of Main.messageTray.getSources?.() ?? [])
            this._watchSource(source);
        this._trayIds = [
            Main.messageTray.connect('source-added', (_t, source) => {
                this._watchSource(source);
                this._renderNotifications();
            }),
            Main.messageTray.connect('source-removed', (_t, source) => {
                this._sources.delete(source);
                this._renderNotifications();
            }),
        ];
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._renderClocks();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        const ids = ['notification-added', 'notification-removed'].map(signal =>
            source.connect(signal, () => this._renderNotifications()));
        this._sources.set(source, ids);
    }

    close() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        for (const id of this._trayIds ?? [])
            Main.messageTray.disconnect(id);
        this._trayIds = [];
        for (const [source, ids] of this._sources) {
            for (const id of ids)
                source.disconnect(id);
        }
        this._sources.clear();
    }

    setDark(dark) {
        this.actor.remove_style_class_name('m3-light');
        this.actor.remove_style_class_name('m3-dark');
        this.actor.add_style_class_name(dark ? 'm3-dark' : 'm3-light');
    }

    destroy() {
        this.close();
        if (this._weather && this._weatherId)
            this._weather.disconnect(this._weatherId);
        this._weatherId = 0;
        this._weather = null;
        this.actor.destroy();
    }
}

/** Replaces the content of the shell's date menu with the Material 3 layout. */
export class DateMenuFeature {
    constructor(settings) {
        this._settings = settings;
        this._iface = null;
        this._ids = [];
    }

    enable() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu?.menu)
            return;
        this._menu = dateMenu.menu;
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        // The original content stays alive (the shell updates it); it is only hidden.
        this._hidden = this._menu.box.get_children().map(actor => [actor, actor.visible]);
        for (const [actor] of this._hidden)
            actor.hide();

        this._panel = new DatePanel(this._settings, () => this._menu.close());
        this._menu.box.add_child(this._panel.actor);
        // The shell's popup frame goes transparent: the panel draws its own surface.
        this._menu.actor.set_style('-arrow-rise: 0px; -arrow-background-color: transparent; ' +
            '-arrow-border-width: 0px; -arrow-border-color: transparent; box-shadow: none;');
        this._menu.box.set_style('background-color: transparent; border: 0; padding: 0; box-shadow: none;');
        this._syncDark();
        for (const key of ['datemenu-scale', 'datemenu-font-scale']) {
            if (this._settings.settings_schema.has_key(key))
                this._ids.push([this._settings, this._settings.connect(`changed::${key}`, () => this._rebuild())]);
        }
        this._ids.push([this._iface, this._iface.connect('changed::color-scheme', () => this._syncDark())]);
        this._ids.push([this._menu, this._menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._panel.open();
            else
                this._panel.close();
        })]);
    }

    disable() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._ids = [];
        this._panel?.destroy();
        this._panel = null;
        for (const [actor, visible] of this._hidden ?? []) {
            if (visible)
                actor.show();
        }
        this._hidden = null;
        this._menu?.actor.set_style(null);
        this._menu?.box.set_style(null);
        this._menu = null;
        this._iface?.run_dispose();
        this._iface = null;
    }

    /** Size settings changed: build the panel again. */
    _rebuild() {
        this.disable();
        this.enable();
    }

    _syncDark() {
        this._panel?.setDark(this._iface.get_string('color-scheme') === 'prefer-dark');
    }
}
