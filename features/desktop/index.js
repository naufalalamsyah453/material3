import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {_} from '../../i18n.js';
import {ContextMenu} from '../dock/contextMenu.js';
import {openSettings} from '../settings/launcher.js';
import {openWithItems, showProperties} from '../fileTools.js';

const ATTRS = 'standard::name,standard::display-name,standard::icon,standard::is-hidden,standard::type,' +
    'metadata::custom-icon,metadata::custom-icon-name';
const CLIPBOARD_MIME = 'x-special/gnome-copied-files';
const DOUBLE_CLICK = 400; // ms
const DRAG_THRESHOLD = 6; // px
const MARGIN = 12;

/**
 * Desktop icons drawn by the extension itself, so no other extension is
 * needed. The files of the user's Desktop folder (plus Home and Trash when
 * asked for) sit on a grid above the wallpaper and below the windows. A
 * click selects, a double click opens, dragging moves (positions are
 * remembered), dragging on the wallpaper draws a selection rectangle, and
 * the right button opens a menu in the extension's own style.
 */
export class DesktopFeature {
    constructor(settings) {
        this._settings = settings;
        this._items = [];
        this._ids = [];
        this._timeouts = new Set();
        this._clipboard = null;
    }

    enable() {
        this._root = new St.Widget({
            style_class: 'm3-qs m3-dark m3-di-root',
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            clip_to_allocation: true,
        });
        this._rubber = new St.Widget({style_class: 'm3-di-rubber', visible: false});
        this._root.add_child(this._rubber);
        Main.layoutManager._backgroundGroup.add_child(this._root);

        this._menu = new ContextMenu({});
        this._menu.actor.add_style_class_name('m3-dark');
        Main.layoutManager.addChrome(this._menu.actor);

        this._root.connect('button-press-event', (_a, event) => this._onPress(event));
        this._root.connect('motion-event', (_a, event) => this._onMotion(event));
        this._root.connect('button-release-event', (_a, event) => this._onRelease(event));

        const watch = (object, signal, callback) => {
            this._ids.push([object, object.connect(signal, callback)]);
        };
        for (const key of ['desktop-icon-size', 'desktop-show-home', 'desktop-show-trash'])
            watch(this._settings, `changed::${key}`, () => this._reload());
        watch(Main.layoutManager, 'monitors-changed', () => this._queue());
        watch(Main.layoutManager, 'startup-complete', () => this._queue());
        watch(global.display, 'workareas-changed', () => this._queue());
        watch(Main.overview, 'showing', () => (this._root.visible = false));
        watch(Main.overview, 'hidden', () => (this._root.visible = true));

        const dir = this._desktopDir();
        this._monitor = null;
        if (dir) {
            try {
                this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
                this._monitorId = this._monitor.connect('changed', () => this._queue());
            } catch (e) {
                console.error(`material3: desktop monitor: ${e.message}`);
            }
        }
        this._reload();
    }

    disable() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._ids = [];
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        this._grab?.dismiss();
        this._grab = null;
        if (this._menu) {
            Main.layoutManager.removeChrome(this._menu.actor);
            this._menu.destroy();
            this._menu = null;
        }
        this._root?.destroy();
        this._root = null;
        this._items = [];
    }

    // --- Files ------------------------------------------------------------

    _desktopDir() {
        const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        return path ? Gio.File.new_for_path(path) : null;
    }

    /** Reload, merging bursts of file events into one pass. */
    _queue() {
        if (this._queued)
            return;
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._timeouts.delete(id);
            this._queued = 0;
            this._reload();
            return GLib.SOURCE_REMOVE;
        });
        this._queued = id;
        this._timeouts.add(id);
    }

    _reload() {
        if (!this._root)
            return;
        const old = new Map(this._items.map(item => [item.key, item]));
        const keep = new Set();
        const list = [];

        const special = (key, name, icon, file) => ({
            key, special: true, name, gicon: new Gio.ThemedIcon({name: icon}), file, isDir: true,
        });
        if (this._settings.get_boolean('desktop-show-home')) {
            list.push(special('@home', _('Home'), 'user-home',
                Gio.File.new_for_path(GLib.get_home_dir())));
        }
        if (this._settings.get_boolean('desktop-show-trash')) {
            const trash = special('@trash', _('Trash'), 'user-trash', Gio.File.new_for_uri('trash:///'));
            trash.isTrash = true;
            list.push(trash);
        }

        const dir = this._desktopDir();
        const files = [];
        try {
            const enumerator = dir.enumerate_children(ATTRS, Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                if (info.get_is_hidden())
                    continue;
                const file = dir.get_child(info.get_name());
                const entry = {
                    key: info.get_name(),
                    name: info.get_display_name(),
                    gicon: info.get_icon(),
                    file,
                    isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                };
                const custom = this._customIcon(info);
                if (info.get_name().endsWith('.desktop')) {
                    const app = Gio.DesktopAppInfo.new_from_filename(file.get_path());
                    if (app) {
                        entry.app = app;
                        entry.name = app.get_name();
                        entry.gicon = app.get_icon() ?? entry.gicon;
                    }
                }
                if (custom)
                    entry.gicon = custom;
                files.push(entry);
            }
            enumerator.close(null);
        } catch (e) {
            console.error(`material3: desktop folder: ${e.message}`);
        }
        files.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
        list.push(...files);

        for (const entry of list) {
            const previous = old.get(entry.key);
            if (previous) {
                keep.add(entry.key);
                Object.assign(previous, entry);
                entry.actor = previous.actor;
                entry.selected = previous.selected;
                entry.cell = previous.cell;
                this._fillActor(previous);
                Object.assign(entry, previous);
            } else {
                entry.selected = false;
                entry.actor = this._makeActor();
                this._root.add_child(entry.actor);
                this._fillActor(entry);
            }
        }
        for (const [key, item] of old) {
            if (!keep.has(key))
                item.actor.destroy();
        }
        this._items = list;
        this._layout();
    }

    /** Icon chosen in Properties: an image file (as Files stores it) or an icon theme name. */
    _customIcon(info) {
        const uri = info.get_attribute_string('metadata::custom-icon');
        if (uri)
            return new Gio.FileIcon({file: Gio.File.new_for_uri(uri)});
        const name = info.get_attribute_string('metadata::custom-icon-name');
        return name ? new Gio.ThemedIcon({name}) : null;
    }

    // --- Layout -----------------------------------------------------------

    _size() {
        return this._settings.get_int('desktop-icon-size');
    }

    _cell() {
        const size = this._size();
        return {w: size + 44, h: size + 58};
    }

    _readPositions() {
        try {
            return JSON.parse(this._settings.get_string('desktop-positions'));
        } catch {
            return {};
        }
    }

    _savePositions() {
        const positions = {};
        for (const item of this._items)
            positions[item.key] = item.cell;
        this._settings.set_string('desktop-positions', JSON.stringify(positions));
    }

    _layout() {
        if (!this._root)
            return;
        const monitor = Main.layoutManager.primaryIndex;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        this._root.set_position(area.x, area.y);
        this._root.set_size(area.width, area.height);
        Main.layoutManager._backgroundGroup.set_child_above_sibling(this._root, null);

        const {w, h} = this._cell();
        this._cols = Math.max(1, Math.floor((area.width - MARGIN) / w));
        this._rows = Math.max(1, Math.floor((area.height - MARGIN) / h));

        const saved = this._readPositions();
        const taken = new Set();
        const placed = [];
        let changed = false;
        for (const item of this._items) {
            const cell = saved[item.key] ?? item.cell;
            if (cell && cell[0] < this._cols && cell[1] < this._rows && !taken.has(`${cell[0]},${cell[1]}`)) {
                item.cell = cell;
                taken.add(`${cell[0]},${cell[1]}`);
                placed.push(item);
            } else {
                item.cell = null;
            }
        }
        // New (or displaced) icons take the first free cell, top to bottom, then left to right.
        for (const item of this._items.filter(i => !i.cell)) {
            for (let c = 0; c < this._cols && !item.cell; c++) {
                for (let r = 0; r < this._rows; r++) {
                    if (!taken.has(`${c},${r}`)) {
                        item.cell = [c, r];
                        taken.add(`${c},${r}`);
                        changed = true;
                        break;
                    }
                }
            }
            if (!item.cell)
                item.cell = [0, 0]; // more icons than cells: they overlap rather than vanish
        }
        for (const item of this._items)
            this._place(item);
        if (changed)
            this._savePositions();
    }

    _place(item) {
        const {w, h} = this._cell();
        item.actor.remove_all_transitions();
        item.actor.translation_x = 0;
        item.actor.translation_y = 0;
        item.actor.set_size(w - 4, h - 4);
        item.actor.set_position(MARGIN + item.cell[0] * w, MARGIN + item.cell[1] * h);
    }

    _makeActor() {
        const actor = new St.BoxLayout({
            style_class: 'm3-di',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: false,
        });
        actor._icon = new St.Icon({x_align: Clutter.ActorAlign.CENTER});
        actor._label = new St.Label({style_class: 'm3-di-label', x_align: Clutter.ActorAlign.CENTER});
        actor._label.clutter_text.set_line_wrap(true);
        actor._label.clutter_text.set_line_wrap_mode(2); // Pango.WrapMode.WORD_CHAR
        actor._label.clutter_text.set_ellipsize(3); // Pango.EllipsizeMode.END
        actor._label.clutter_text.set_justify(true);
        actor._label.clutter_text.set_line_alignment(1); // Pango.Alignment.CENTER
        actor.add_child(actor._icon);
        actor.add_child(actor._label);
        return actor;
    }

    _fillActor(item) {
        const size = this._size();
        const {w} = this._cell();
        item.actor._icon.set_gicon(item.gicon);
        item.actor._icon.set_icon_size(size);
        item.actor._label.set_text(item.name);
        item.actor._label.set_width(w - 12);
        item.actor._label.set_height(34);
        item.actor._label.clip_to_allocation = true;
        this._paint(item);
    }

    _paint(item) {
        if (item.selected)
            item.actor.add_style_class_name('m3-di-selected');
        else
            item.actor.remove_style_class_name('m3-di-selected');
    }

    // --- Selection and pointer ----------------------------------------------

    _local(event) {
        const [x, y] = event.get_coords();
        const [, lx, ly] = this._root.transform_stage_point(x, y);
        return [lx, ly];
    }

    _itemAt(x, y) {
        return [...this._items].reverse().find(item => {
            const a = item.actor;
            return x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height;
        }) ?? null;
    }

    _select(items) {
        const set = new Set(items);
        for (const item of this._items) {
            item.selected = set.has(item);
            this._paint(item);
        }
    }

    _selected() {
        return this._items.filter(item => item.selected);
    }

    _onPress(event) {
        const button = event.get_button();
        const [x, y] = this._local(event);
        const hit = this._itemAt(x, y);
        const ctrl = !!(event.get_state() & Clutter.ModifierType.CONTROL_MASK);

        if (button === Clutter.BUTTON_SECONDARY) {
            if (hit && !hit.selected)
                this._select([hit]);
            else if (!hit)
                this._select([]);
            const [sx, sy] = event.get_coords();
            this._openMenu(hit ? this._itemMenu() : this._backgroundMenu(), sx, sy);
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        this._menu.close(false);
        // No stage grab on a plain click: it is taken only once a drag starts,
        // so a lost button release can never leave the shell without input.
        this._releaseGrab();
        this._press = {x, y, hit, ctrl, moved: false, base: this._selected()};

        if (hit) {
            if (ctrl)
                this._select(hit.selected ? this._selected().filter(i => i !== hit) : [...this._selected(), hit]);
            else if (!hit.selected)
                this._select([hit]);

            const now = GLib.get_monotonic_time() / 1000;
            if (!ctrl && this._lastClick?.item === hit && now - this._lastClick.time < DOUBLE_CLICK) {
                this._lastClick = null;
                this._endPress();
                this._open(hit);
                return Clutter.EVENT_STOP;
            }
            this._lastClick = {item: hit, time: now};
        } else if (!ctrl) {
            this._select([]);
        }
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        const press = this._press;
        if (!press)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = this._local(event);
        const dx = x - press.x;
        const dy = y - press.y;
        if (!press.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD)
            return Clutter.EVENT_STOP;
        press.moved = true;
        if (!this._grab) {
            try {
                this._grab = global.stage.grab(this._root);
            } catch {
                this._grab = null;
            }
        }

        if (press.hit) {
            for (const item of this._selected()) {
                item.actor.translation_x = dx;
                item.actor.translation_y = dy;
            }
        } else {
            const left = Math.min(x, press.x);
            const top = Math.min(y, press.y);
            const width = Math.abs(dx);
            const height = Math.abs(dy);
            this._rubber.set_position(left, top);
            this._rubber.set_size(width, height);
            this._rubber.show();
            const hits = this._items.filter(({actor: a}) =>
                a.x < left + width && a.x + a.width > left && a.y < top + height && a.y + a.height > top);
            this._select(press.ctrl ? [...new Set([...press.base, ...hits])] : hits);
        }
        return Clutter.EVENT_STOP;
    }

    _onRelease() {
        const press = this._press;
        if (!press)
            return Clutter.EVENT_PROPAGATE;
        if (press.moved && press.hit)
            this._dropSelected();
        this._endPress();
        return Clutter.EVENT_STOP;
    }

    _endPress() {
        this._press = null;
        this._rubber.hide();
        this._releaseGrab();
    }

    _releaseGrab() {
        try {
            this._grab?.dismiss();
        } catch (e) {
            console.error(`material3: desktop grab: ${e.message}`);
        }
        this._grab = null;
    }

    /** Snap the dragged icons to the grid; an icon whose target is taken or off-screen stays put. */
    _dropSelected() {
        const {w, h} = this._cell();
        const moving = this._selected();
        const occupied = new Set(this._items.filter(i => !i.selected).map(i => `${i.cell[0]},${i.cell[1]}`));
        const targets = new Map();
        for (const item of moving) {
            const c = Math.round((item.actor.x + item.actor.translation_x - MARGIN) / w);
            const r = Math.round((item.actor.y + item.actor.translation_y - MARGIN) / h);
            const key = `${c},${r}`;
            if (c >= 0 && r >= 0 && c < this._cols && r < this._rows && !occupied.has(key)) {
                occupied.add(key);
                targets.set(item, [c, r]);
            }
        }
        for (const item of moving) {
            if (targets.has(item))
                item.cell = targets.get(item);
        }
        for (const item of this._items)
            this._place(item);
        this._savePositions();
    }

    // --- Actions ------------------------------------------------------------

    _launchContext() {
        return global.create_app_launch_context(global.get_current_time(), -1);
    }

    _open(item) {
        try {
            if (item.app)
                item.app.launch([], this._launchContext());
            else
                Gio.AppInfo.launch_default_for_uri(item.file.get_uri(), this._launchContext());
        } catch (e) {
            console.error(`material3: cannot open ${item.name}: ${e.message}`);
        }
    }

    _openUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, this._launchContext());
        } catch (e) {
            console.error(`material3: cannot open ${uri}: ${e.message}`);
        }
    }

    _run(argv, reload = false) {
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            if (reload) {
                proc.wait_async(null, () => {
                    if (this._root)
                        this._queue();
                });
            }
        } catch (e) {
            console.error(`material3: cannot run ${argv[0]}: ${e.message}`);
        }
    }

    _openMenu(items, x, y) {
        this._menuAt = [x, y];
        this._menu.open(items.map(entry => entry.separator ? entry : {
            ...entry,
            activate: () => {
                try {
                    entry.activate();
                } catch (e) {
                    console.error(`material3: desktop action failed: ${e.message}`);
                }
            },
        }), {x, y, placement: 'pointer'});
    }

    _itemMenu() {
        const selected = this._selected();
        const single = selected.length === 1 ? selected[0] : null;
        const files = selected.filter(i => !i.special);
        const items = [];

        items.push({icon: 'open_in_new', label: _('Open'), activate: () => selected.forEach(i => this._open(i))});
        if (single?.isTrash) {
            items.push({separator: true});
            items.push({icon: 'delete_forever', label: _('Empty Trash'), destructive: true,
                activate: () => this._run(['gio', 'trash', '--empty'])});
            return items;
        }
        if (files.length > 0) {
            items.push({
                icon: 'folder_open',
                label: _('Show in Files'),
                activate: () => this._openUri(this._desktopDir().get_uri()),
            });
            items.push({separator: true});
            items.push({icon: 'content_cut', label: _('Cut'), activate: () => this._copy(files, 'cut')});
            items.push({icon: 'content_copy', label: _('Copy'), activate: () => this._copy(files, 'copy')});
            if (single && !single.special) {
                items.push({icon: 'apps', label: _('Open With'), activate: () => {
                    const [mx, my] = this._menuAt ?? [0, 0];
                    this._openMenu(openWithItems(single.file, {
                        back: () => this._openMenu(this._itemMenu(), mx, my),
                    }), mx, my);
                }});
                items.push({icon: 'edit', label: _('Rename…'), activate: () => this._rename(single)});
                items.push({icon: 'info', label: _('Properties'), activate: () => showProperties(single.file, {gicon: single.gicon, isDir: single.isDir, onDone: () => this._queue()})});
            }
            items.push({separator: true});
            items.push({icon: 'delete', label: _('Move to Trash'), destructive: true,
                activate: () => files.forEach(i => this._trash(i))});
        }
        return items;
    }

    _backgroundMenu() {
        return [
            {icon: 'create_new_folder', label: _('New Folder'), activate: () => this._create(true)},
            {icon: 'note_add', label: _('New Document'), activate: () => this._create(false)},
            {separator: true},
            {icon: 'content_paste', label: _('Paste'), activate: () => this._paste()},
            {icon: 'select_all', label: _('Select All'), activate: () => this._select(this._items)},
            {separator: true},
            {icon: 'folder_open', label: _('Open Desktop Folder'), activate: () => this._openUri(this._desktopDir().get_uri())},
            {icon: 'wallpaper', label: _('Change Background'), activate: () => openSettings('appearance')},
            {icon: 'desktop_windows', label: _('Display Settings'), activate: () => openSettings('display')},
            {icon: 'settings', label: _('Settings'), activate: () => openSettings()},
        ];
    }

    _unique(dir, name) {
        let candidate = dir.get_child(name);
        if (!candidate.query_exists(null))
            return candidate;
        const dot = name.lastIndexOf('.');
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
        for (let n = 2; ; n++) {
            candidate = dir.get_child(`${stem} (${n})${ext}`);
            if (!candidate.query_exists(null))
                return candidate;
        }
    }

    _create(folder) {
        const dir = this._desktopDir();
        this._ask(folder ? _('New Folder') : _('New Document'), folder ? _('New Folder') : _('New Document'), name => {
            const target = this._unique(dir, name);
            try {
                if (folder)
                    target.make_directory(null);
                else
                    target.create(Gio.FileCreateFlags.NONE, null).close(null);
            } catch (e) {
                console.error(`material3: cannot create ${name}: ${e.message}`);
            }
        });
    }

    _rename(item) {
        this._ask(_('Rename'), item.file.get_basename(), name => {
            try {
                item.file.set_display_name(name, null);
            } catch (e) {
                console.error(`material3: cannot rename: ${e.message}`);
            }
        });
    }

    _trash(item) {
        try {
            item.file.trash(null);
        } catch (e) {
            console.error(`material3: cannot trash ${item.name}: ${e.message}`);
        }
    }

    /** Copy/cut: the files go on the clipboard in the format Files and other apps share. */
    _copy(items, mode) {
        const text = `${mode}\n${items.map(i => i.file.get_uri()).join('\n')}`;
        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, CLIPBOARD_MIME,
            GLib.Bytes.new(new TextEncoder().encode(text)));
    }

    _paste() {
        const dir = this._desktopDir();
        St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, CLIPBOARD_MIME, (_c, bytes) => {
            if (!bytes)
                return;
            const [mode, ...uris] = new TextDecoder().decode(bytes.get_data()).split('\n').filter(Boolean);
            for (const uri of uris) {
                const source = Gio.File.new_for_uri(uri);
                const from = source.get_path();
                if (!from)
                    continue;
                const target = this._unique(dir, source.get_basename());
                this._run(mode === 'cut'
                    ? ['mv', '--', from, target.get_path()]
                    : ['cp', '-r', '--', from, target.get_path()]);
            }
        });
    }

    /** One-line text prompt in the shell's modal dialog. */
    _ask(title, initial, done) {
        const dialog = new ModalDialog.ModalDialog({styleClass: 'prompt-dialog'});
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 12px; min-width: 320px;'});
        box.add_child(new St.Label({text: title, style_class: 'headline'}));
        const entry = new St.Entry({text: initial, can_focus: true});
        box.add_child(entry);
        dialog.contentLayout.add_child(box);

        const accept = () => {
            const name = entry.get_text().trim().replace(/\//g, '');
            dialog.close();
            if (name)
                done(name);
        };
        dialog.addButton({label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.addButton({label: _('OK'), action: accept, default: true});
        entry.clutter_text.connect('activate', accept);
        dialog.open();
        entry.grab_key_focus();
        entry.clutter_text.set_selection(0, initial.includes('.') ? initial.lastIndexOf('.') : -1);
    }
}
