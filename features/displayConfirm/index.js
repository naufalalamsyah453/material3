import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from '../../i18n.js';
import {symbolIcon, textLabel} from '../quickSettings/widgets.js';

const SECONDS = 20;

/**
 * The "Keep these display settings?" prompt, in the extension's style instead
 * of the shell's own dialog. The shell asks through `confirm-display-change`
 * on its window manager; this feature answers with `complete_display_change`.
 */
export class DisplayConfirmFeature {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const wm = Main.wm;
        this._original = wm._confirmDisplayChange;
        wm._confirmDisplayChange = () => this._show();
    }

    disable() {
        this._close(false);
        if (this._original)
            Main.wm._confirmDisplayChange = this._original;
        this._original = null;
        this._iface = null;
    }

    _show() {
        this._close(false);
        const monitor = Main.layoutManager.primaryMonitor;
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';

        this._actor = new St.Widget({
            style_class: `m3-qs ${dark ? 'm3-dark' : 'm3-light'}`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
        });
        const scrim = new St.Widget({style_class: 'm3-dc-scrim', x_expand: true, y_expand: true});
        this._actor.add_child(scrim);

        const card = new St.BoxLayout({
            style_class: 'm3-dc-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        card.add_child(symbolIcon('desktop_windows', {size: 28, filled: true, styleClass: 'm3-dc-icon'}));
        card.add_child(textLabel(_('Keep these display settings?'), 'm3-dc-title'));
        this._message = textLabel('', 'm3-dc-message');
        this._message.clutter_text.set_line_wrap(true);
        card.add_child(this._message);

        const buttons = new St.BoxLayout({style_class: 'm3-dc-buttons', x_align: Clutter.ActorAlign.END});
        const revert = new St.Button({
            style_class: 'm3-dc-button m3-dc-tonal', can_focus: true, reactive: true,
            child: textLabel(_('Revert Settings'), 'm3-dc-button-text'),
        });
        const keep = new St.Button({
            style_class: 'm3-dc-button m3-dc-filled', can_focus: true, reactive: true,
            child: textLabel(_('Keep Changes'), 'm3-dc-button-text'),
        });
        revert.connect('clicked', () => this._close(false));
        keep.connect('clicked', () => this._close(true));
        buttons.add_child(revert);
        buttons.add_child(keep);
        card.add_child(buttons);
        this._actor.add_child(card);

        this._actor.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._close(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        Main.layoutManager.uiGroup.add_child(this._actor);
        try {
            this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.SYSTEM_MODAL});
        } catch (e) {
            console.error(`material3: display prompt grab: ${e.message}`);
            this._grab = null;
        }
        keep.grab_key_focus();

        this._left = SECONDS;
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._left--;
            if (this._left <= 0) {
                this._timer = 0;
                this._close(false);
                return GLib.SOURCE_REMOVE;
            }
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        this._message.set_text(_('The display settings will revert in %d seconds.').format(this._left));
    }

    /** Close the prompt and tell the shell whether the new settings stay. */
    _close(keep) {
        if (!this._actor)
            return;
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._actor.destroy();
        this._actor = null;
        try {
            Main.wm._shellwm.complete_display_change(keep);
        } catch (e) {
            console.error(`material3: display change answer: ${e.message}`);
        }
    }
}
