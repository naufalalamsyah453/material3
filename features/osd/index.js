import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {px} from '../quickSettings/ui.js';
import {centerBin, symbolIcon, textLabel} from '../quickSettings/widgets.js';

const HIDE_DELAY_MS = 1500;
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 208;
// The fill never gets shorter than this, so the icon always sits inside it.
const MIN_FILL = 52;
const EDGE_MARGIN = 24;

/**
 * What the shell's OSD icon says about the control it shows.
 *
 * @param {Gio.Icon|null} icon
 * @param {number} level 0..1 (can exceed 1 for over-amplified volume)
 * @returns {{kind: string, symbol: string}|null} null for OSDs this feature does not draw
 */
function describe(icon, level) {
    let names = icon?.get_names?.() ?? icon?.names ?? [];
    if (names.length === 0 && icon?.to_string)
        names = [icon.to_string() ?? ''];
    const name = names.join(' ');

    if (/microphone/.test(name))
        return {kind: 'mic', symbol: /muted/.test(name) || level <= 0 ? 'mic_off' : 'mic'};
    if (/keyboard-brightness/.test(name))
        return {kind: 'keyboard', symbol: 'keyboard'};
    if (/brightness/.test(name)) {
        const symbol = level < 0.34 ? 'brightness_low' : level < 0.67 ? 'brightness_medium' : 'brightness_high';
        return {kind: 'brightness', symbol};
    }
    if (/audio-volume/.test(name)) {
        const symbol = /muted/.test(name) || level <= 0
            ? 'volume_off'
            : level < 0.5 ? 'volume_down' : 'volume_up';
        return {kind: 'volume', symbol};
    }
    return null;
}

/**
 * Material 3 volume / brightness indicator, in place of the shell's OSD:
 * a vertical pill on the right edge whose rounded fill rises with the level.
 */
export class OsdFeature {
    constructor(settings) {
        this._settings = settings;
        this._iface = null;
        this._ifaceId = 0;
        this._actor = null;
        this._hideId = 0;
        this._shown = false;
        this._patched = [];
        this._logged = 0;
    }

    enable() {
        this._build();

        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ifaceId = this._iface.connect('changed::color-scheme', () => this._syncMode());
        this._syncMode();

        // The shell's volume slider and the ShowOSD D-Bus call (gnome-settings-
        // daemon's volume and brightness keys) enter through showAll(),
        // showOne() or show(); all of them end in _showOsdWindow(). Every
        // entry point is patched, so the indicator is drawn whichever way a
        // given shell version routes the call.
        const manager = Main.osdWindowManager;
        this._patched = [];
        const patch = (name, wrap) => {
            if (typeof manager[name] !== 'function')
                return;
            manager[name] = wrap(manager[name]);
            this._patched.push(name);
        };

        patch('showAll', original => (icon, label, level, maxLevel, ...rest) => {
            if (this._show(Main.layoutManager.primaryIndex, icon, level, maxLevel, true))
                return;
            original.call(manager, icon, label, level, maxLevel, ...rest);
        });
        patch('showOne', original => (monitorIndex, icon, label, level, maxLevel, ...rest) => {
            if (this._show(monitorIndex, icon, level, maxLevel, true))
                return;
            original.call(manager, monitorIndex, icon, label, level, maxLevel, ...rest);
        });
        patch('show', original => (...args) => {
            if (this._showAny(args))
                return;
            original.apply(manager, args);
        });
        patch('_showOsdWindow', original => (monitorIndex, icon, label, level, maxLevel) => {
            if (this._show(monitorIndex, icon, level, maxLevel, false))
                return;
            original.call(manager, monitorIndex, icon, label, level, maxLevel);
        });

        console.log(`material3: OSD installed (${this._patched.join(', ') || 'nothing to patch'})`);
    }

    /**
     * show() has two shapes: (monitorIndex, icon, label, level, maxLevel) in
     * older shells and (icon, label, {[monitorIndex]: {level, maxLevel}}) in
     * current ones.
     *
     * @returns {boolean} true when it was drawn here
     */
    _showAny(args) {
        if (typeof args[0] === 'number') {
            const [monitorIndex, icon, , level, maxLevel] = args;
            return this._show(monitorIndex, icon, level, maxLevel, true);
        }

        const [icon, , levels] = args;
        if (!levels)
            return false;
        const primary = Main.layoutManager.primaryIndex;
        const index = levels[primary] ? primary : Object.keys(levels).map(Number).find(i => levels[i]);
        if (index === undefined)
            return false;
        const {level, maxLevel} = levels[index];
        return this._show(index, icon, level, maxLevel, true);
    }

    disable() {
        // Drop the overrides: the class's own methods show through again.
        for (const name of this._patched ?? [])
            delete Main.osdWindowManager[name];
        this._patched = [];
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;

        if (this._ifaceId)
            this._iface.disconnect(this._ifaceId);
        this._ifaceId = 0;
        this._iface = null;

        if (this._actor) {
            this._actor.remove_all_transitions();
            this._fill.remove_all_transitions();
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }

    _build() {
        // `m3-qs` (+ light/dark) brings the palette rules into scope.
        this._actor = new St.Widget({
            style_class: 'm3-qs',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            visible: false,
            opacity: 0,
        });

        const pill = new St.BoxLayout({
            style_class: 'm3-osd',
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${px(8)}px;`,
        });
        this._actor.add_child(pill);

        this._value = textLabel('', 'm3-osd-value', {x_align: Clutter.ActorAlign.CENTER});
        pill.add_child(this._value);

        this._track = new St.Widget({
            style_class: 'm3-osd-track',
            layout_manager: new Clutter.FixedLayout(),
            width: px(TRACK_WIDTH),
            height: px(TRACK_HEIGHT),
            x_align: Clutter.ActorAlign.CENTER,
        });
        pill.add_child(this._track);

        this._fill = new St.Widget({
            style_class: 'm3-osd-fill',
            width: px(TRACK_WIDTH),
            height: px(MIN_FILL),
        });
        this._fill.set_position(0, px(TRACK_HEIGHT - MIN_FILL));
        this._track.add_child(this._fill);

        // The icon is centered by a bin the size of the lowest MIN_FILL of the
        // track (always inside the fill). Measuring the glyph instead is
        // unreliable: until the icon font is applied, the label is as wide as
        // its ligature name ("brightness_medium"), which threw the icon off.
        this._icon = symbolIcon('volume_up', {size: 24, filled: true, styleClass: 'm3-osd-icon'});
        const iconHolder = centerBin(this._icon, '', {
            width: px(TRACK_WIDTH),
            height: px(MIN_FILL),
        });
        iconHolder.set_position(0, px(TRACK_HEIGHT - MIN_FILL));
        this._track.add_child(iconHolder);

        // (The actor is not reactive, so it never takes input; this shell has
        // no `affectsInputRegion` parameter.)
        Main.layoutManager.addChrome(this._actor, {
            affectsStruts: false,
            trackFullscreen: false,
        });
    }

    _syncMode() {
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        this._actor.remove_style_class_name('m3-light');
        this._actor.remove_style_class_name('m3-dark');
        this._actor.add_style_class_name(dark ? 'm3-dark' : 'm3-light');
    }

    /**
     * @returns {boolean} false when the shell should draw this OSD itself
     */
    _show(monitorIndex, icon, level, maxLevel, explicit = false) {
        if (this._logged < 6) {
            this._logged++;
            const names = icon?.get_names?.() ?? [];
            console.log(`material3: OSD request monitor=${monitorIndex} icon=${names.join(',')} level=${level} max=${maxLevel}`);
        }

        if (level === null || level === undefined || !this._actor)
            return false;
        const info = describe(icon, level);
        if (!info)
            return false;

        // One indicator: the per-monitor calls of showAll() end up here too,
        // so unless the call named its monitor, only the primary one draws.
        if (!explicit && monitorIndex !== Main.layoutManager.primaryIndex)
            return true;

        // The shell passes -1 when there is no maximum.
        const max = maxLevel > 0 ? maxLevel : 1;
        const fraction = Math.max(0, Math.min(1, level / max));
        const track = px(TRACK_HEIGHT);
        const minFill = px(MIN_FILL);
        const fillHeight = Math.round(minFill + (track - minFill) * fraction);

        this._icon.set_text(info.symbol);
        this._value.set_text(`${Math.round(level * 100)}`);

        this._fill.remove_all_transitions();
        if (this._shown) {
            this._fill.ease({
                height: fillHeight,
                y: track - fillHeight,
                duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._fill.height = fillHeight;
            this._fill.y = track - fillHeight;
        }

        this._place(monitorIndex);
        this._reveal();
        return true;
    }

    /** Right edge, vertically centered on the monitor. */
    _place(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex] ?? Main.layoutManager.primaryMonitor;
        const [, width] = this._actor.get_preferred_width(-1);
        const [, height] = this._actor.get_preferred_height(width);
        this._actor.set_position(
            Math.round(monitor.x + monitor.width - width - px(EDGE_MARGIN)),
            Math.round(monitor.y + (monitor.height - height) / 2));
    }

    _reveal() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideId = 0;
            this._hide();
            return GLib.SOURCE_REMOVE;
        });

        if (this._shown)
            return;
        this._shown = true;

        this._actor.remove_all_transitions();
        this._actor.visible = true;
        this._actor.translation_x = px(16);
        this._actor.ease({
            opacity: 255,
            translation_x: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hide() {
        this._shown = false;
        this._actor.remove_all_transitions();
        this._actor.ease({
            opacity: 0,
            translation_x: px(16),
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._shown)
                    this._actor.visible = false;
            },
        });
    }
}
