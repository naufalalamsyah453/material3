import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {createSwitch} from './quickSettings/switch.js';

import {_} from '../i18n.js';

function launchContext() {
    try {
        return global.create_app_launch_context(global.get_current_time(), -1);
    } catch {
        return null;
    }
}

/**
 * Menu entries listing the apps that can open `file`, with a Back entry
 * first. `back` returns to the previous menu; `done` runs after an app starts.
 */
export function openWithItems(file, {back, done = () => {}}) {
    const items = [{icon: 'arrow_back', label: _('Open With'), activate: back}, {separator: true}];
    let type = null;
    try {
        type = file.query_info('standard::content-type', Gio.FileQueryInfoFlags.NONE, null).get_content_type();
    } catch (e) {
        console.error(`material3: open with: ${e.message}`);
    }
    const apps = type ? Gio.AppInfo.get_recommended_for_type(type) : [];
    const all = apps.length > 0 ? apps : (type ? Gio.AppInfo.get_all_for_type(type) : []);
    for (const info of all) {
        items.push({
            icon: 'apps',
            label: info.get_display_name(),
            activate: () => {
                done();
                try {
                    info.launch_uris([file.get_uri()], launchContext());
                } catch (e) {
                    console.error(`material3: cannot open with ${info.get_display_name()}: ${e.message}`);
                }
            },
        });
    }
    if (all.length === 0)
        items.push({icon: 'block', label: _('No application found'), activate: back});
    return items;
}

/**
 * Properties dialog: name, icon, facts and the permission to run the file as
 * a program (a toggle).
 *
 * @param {Gio.File} file
 * @param {object} opts
 * @param {Gio.Icon} opts.gicon current icon
 * @param {boolean} [opts.isDir]
 * @param {function(): void} [opts.onDone] after changes were applied
 */
export function showProperties(file, {gicon, isDir = false, onDone = () => {}}) {
    const item = {file, gicon, isDir};
    const self = {
        _root: true,
        _queue: onDone,
        _run(argv) {
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
                proc.wait_async(null, () => onDone());
            } catch (e) {
                console.error(`material3: cannot run ${argv[0]}: ${e.message}`);
            }
        },
    };
    showPropertiesFor.call(self, item);
}

function showPropertiesFor(item) {
    const file = item.file;
    let mode = 0;
    let customIcon = '';
    const facts = [];
    try {
        const info = file.query_info('unix::mode,standard::size,standard::content-type,time::modified,' +
            'metadata::custom-icon,metadata::custom-icon-name',
            Gio.FileQueryInfoFlags.NONE, null);
        mode = info.get_attribute_uint32('unix::mode');
        const type = info.get_content_type();
        if (type)
            facts.push([_('Type'), Gio.content_type_get_description(type)]);
        if (!item.isDir)
            facts.push([_('Size'), GLib.format_size(info.get_size())]);
        const modified = info.get_attribute_uint64('time::modified');
        if (modified > 0) {
            facts.push([_('Last modified'),
                GLib.DateTime.new_from_unix_local(modified).format('%x, %H:%M')]);
        }
        const uri = info.get_attribute_string('metadata::custom-icon');
        customIcon = uri ? Gio.File.new_for_uri(uri).get_path() ?? uri
            : info.get_attribute_string('metadata::custom-icon-name') ?? '';
    } catch (e) {
        console.error(`material3: properties: ${e.message}`);
    }
    const originalIcon = customIcon;
    const originalExec = (mode & 0o111) !== 0;

    const dialog = new ModalDialog.ModalDialog({styleClass: 'prompt-dialog'});
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 12px; min-width: 380px;'});
    box.add_child(new St.Label({text: _('Properties'), style_class: 'headline'}));

    // Name on the right of a big icon; clicking the icon opens the chooser.
    const top = new St.BoxLayout({style: 'spacing: 16px;'});
    const preview = new St.Icon({gicon: item.gicon, icon_size: 64});
    const iconButton = new St.Button({
        child: preview, can_focus: true, y_align: Clutter.ActorAlign.START,
        accessible_name: _('Change icon'),
        style: 'padding: 10px; border-radius: 18px; background-color: rgba(255, 255, 255, 0.08);',
    });
    top.add_child(iconButton);
    const fields = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;'});
    fields.add_child(new St.Label({text: _('Name')}));
    const nameEntry = new St.Entry({text: file.get_basename(), can_focus: true, x_expand: true});
    fields.add_child(nameEntry);
    fields.add_child(new St.Label({text: _('Click the icon to change it'), style: 'font-size: 11px; opacity: 150;'}));
    top.add_child(fields);
    box.add_child(top);

    const iconRow = new St.BoxLayout({style: 'spacing: 8px;'});
    const iconEntry = new St.Entry({text: customIcon, hint_text: _('Icon: image path or icon name (default)'), can_focus: true, x_expand: true});
    iconRow.add_child(iconEntry);
    const reset = new St.Button({label: _('Reset'), style_class: 'button', can_focus: true});
    reset.connect('clicked', () => iconEntry.set_text(''));
    iconRow.add_child(reset);
    box.add_child(iconRow);

    // The chooser opens as soon as the icon is clicked (zenity, when installed).
    iconButton.connect('clicked', () => {
        if (!GLib.find_program_in_path('zenity')) {
            iconEntry.grab_key_focus();
            return;
        }
        // The dialog is modal and sits above every window: hide it while the
        // chooser is open, then bring it back with what was typed.
        const reopen = () => {
            try {
                dialog.open();
                iconEntry.grab_key_focus();
            } catch (e) {
                console.error(`material3: dialog reopen: ${e.message}`);
            }
        };
        try {
            const proc = Gio.Subprocess.new(['zenity', '--file-selection', '--title', _('Choose an icon'),
                '--file-filter=Images | *.png *.svg *.jpg *.jpeg *.webp *.xpm *.ico'],
            Gio.SubprocessFlags.STDOUT_PIPE);
            dialog.close();
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    if (out?.trim())
                        iconEntry.set_text(out.trim());
                } catch (e) {
                    console.error(`material3: icon chooser: ${e.message}`);
                }
                if (this._root)
                    reopen();
            });
        } catch (e) {
            console.error(`material3: icon chooser: ${e.message}`);
        }
    });

    if (facts.length > 0) {
        const grid = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style: 'spacing: 4px; margin-top: 4px;'});
        for (const [label, value] of facts) {
            const row = new St.BoxLayout({style: 'spacing: 12px;'});
            row.add_child(new St.Label({text: label, style: 'min-width: 110px; opacity: 160;'}));
            row.add_child(new St.Label({text: value, x_expand: true}));
            grid.add_child(row);
        }
        box.add_child(grid);
    }

    const resolve = text => {
        const value = text.trim();
        if (!value)
            return item.gicon;
        const path = value.startsWith('file://') ? Gio.File.new_for_uri(value).get_path() : value;
        if (path?.startsWith('/') && GLib.file_test(path, GLib.FileTest.EXISTS))
            return new Gio.FileIcon({file: Gio.File.new_for_path(path)});
        return new Gio.ThemedIcon({name: value});
    };
    iconEntry.clutter_text.connect('text-changed', () => preview.set_gicon(resolve(iconEntry.get_text())));

    let exec = null;
    if (!item.isDir) {
        const row = new St.Button({can_focus: true, x_expand: true, reactive: true, track_hover: true,
            style: 'padding: 8px 4px; border-radius: 12px;'});
        const line = new St.BoxLayout({x_expand: true, style: 'spacing: 12px;'});
        line.add_child(new St.Label({text: _('Allow executing as a program'), x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        // The extension's own switch; its styles need an m3-qs ancestor.
        let on = originalExec;
        const toggle = createSwitch({onClicked: () => toggle.setActive(on = !on, true)});
        toggle.setActive(on);
        const holder = new St.Bin({style_class: 'm3-qs m3-dark', child: toggle, y_align: Clutter.ActorAlign.CENTER});
        line.add_child(holder);
        row.set_child(line);
        row.connect('clicked', () => toggle.setActive(on = !on, true));
        exec = {get checked() { return on; }};
        box.add_child(row);
    }
    dialog.contentLayout.add_child(box);

    const apply = () => {
        const name = nameEntry.get_text().trim().replace(/\//g, '');
        const iconText = iconEntry.get_text().trim();
        dialog.close();
        const none = Gio.FileQueryInfoFlags.NONE;
        try {
            if (iconText !== originalIcon) {
                file.set_attribute('metadata::custom-icon', Gio.FileAttributeType.INVALID, null, none, null);
                file.set_attribute('metadata::custom-icon-name', Gio.FileAttributeType.INVALID, null, none, null);
                if (iconText) {
                    const path = iconText.startsWith('file://') ? Gio.File.new_for_uri(iconText).get_path() : iconText;
                    if (path?.startsWith('/'))
                        file.set_attribute_string('metadata::custom-icon', Gio.File.new_for_path(path).get_uri(), none, null);
                    else
                        file.set_attribute_string('metadata::custom-icon-name', iconText, none, null);
                }
            }
            if (exec && exec.checked !== originalExec) {
                const next = exec.checked ? mode | 0o111 : mode & ~0o111;
                try {
                    file.set_attribute_uint32('unix::mode', next, none, null);
                } catch (e) {
                    // Not allowed as this user (a file of root, say): ask for
                    // the password through polkit and run chmod as root.
                    console.error(`material3: chmod needs privileges: ${e.message}`);
                    this._run(['pkexec', 'chmod', exec.checked ? 'a+x' : 'a-x', '--', file.get_path()]);
                }
            }
            if (name && name !== file.get_basename())
                file.set_display_name(name, null);
        } catch (e) {
            console.error(`material3: cannot apply properties: ${e.message}`);
        }
        this._queue();
    };
    dialog.addButton({label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape});
    dialog.addButton({label: _('Apply'), action: apply, default: true});
    dialog.open();
    nameEntry.grab_key_focus();
}
