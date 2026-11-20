import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {_} from '../i18n.js';
import {EXTENSION_DIR, extSettings, gs, hasCommand, later} from '../sys.js';
import {THEME_NAMES} from '../../features/quickSettings/themes.js';
import {palette, unit} from '../theme.js';
import {
    badge, card, customSwitch, getMainWindow, gsFont, gsSelect, gsSlider, heading, hbox, label,
    listCard, pillButton, row, rowsFrom, sectionLabel, sliderBlock, toast, vbox,
} from '../ui.js';

const IFACE = 'org.gnome.desktop.interface';
const BG = 'org.gnome.desktop.background';
const WALLPAPER_DIRS = ['/usr/share/backgrounds', '/usr/share/gnome-background-properties'];
const IMAGE = /\.(jpe?g|png|webp|avif|jxl)$/i;

// Thumbnails decode one at a time, off the main thread, so the page opens at once.
const queue = [];
let busy = false;

function pump() {
    if (busy || queue.length === 0)
        return;
    busy = true;
    const {uri, picture, w, h} = queue.shift();
    const done = () => {
        busy = false;
        GLib.timeout_add(GLib.PRIORITY_LOW, 40, () => {
            pump();
            return GLib.SOURCE_REMOVE;
        });
    };
    Gio.File.new_for_uri(uri).read_async(GLib.PRIORITY_LOW, null, (file, res) => {
        let stream;
        try {
            stream = file.read_finish(res);
        } catch {
            done();
            return;
        }
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, w, h, true, null, (_s, res2) => {
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
                picture.set_paintable(Gdk.Texture.new_for_pixbuf(pixbuf));
            } catch {
                // Unsupported format: the tile stays plain.
            }
            stream.close_async(GLib.PRIORITY_LOW, null, () => {});
            done();
        });
    });
}

function thumbnail(uri, w, h) {
    const picture = new Gtk.Picture({content_fit: Gtk.ContentFit.COVER, can_shrink: true});
    picture.add_css_class('m3-thumb');
    picture.set_size_request(w, h);
    queue.push({uri, picture, w, h});
    pump();
    return picture;
}

function disc(primary, container) {
    const area = new Gtk.DrawingArea();
    area.set_size_request(44, 44);
    area.set_draw_func((_a, cr, w, h) => {
        const r = Math.min(w, h) / 2 - 1;
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.clip();
        cr.setSourceRGBA(...unit(primary()), 1);
        cr.rectangle(0, 0, w / 2, h);
        cr.fill();
        cr.setSourceRGBA(...unit(container()), 1);
        cr.rectangle(w / 2, 0, w / 2, h);
        cr.fill();
        cr.$dispose();
    });
    palette.onChange(() => area.queue_draw());
    return area;
}

function paletteCard() {
    const iface = gs.settings(IFACE);
    const hasAccent = gs.has(IFACE, 'accent-color');
    const ext = extSettings();

    const head = hbox(8);
    head.append(label(_('Accent color'), 'm3-row-title', {hexpand: true}));
    const name = badge(THEME_NAMES[palette.key]);
    head.append(name);

    const flow = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        min_children_per_line: 3,
        max_children_per_line: 9,
        column_spacing: 8,
        row_spacing: 8,
    });
    const buttons = new Map();
    for (const swatch of palette.swatches()) {
        const button = new Gtk.Button();
        button.add_css_class('m3-swatch');
        const content = vbox(6);
        const live = () => palette.swatches().find(s => s.key === swatch.key);
        const dot = disc(() => live().primary, () => live().container);
        dot.halign = Gtk.Align.CENTER;
        content.append(dot);
        content.append(label(THEME_NAMES[swatch.key], 'm3-swatch-text', {xalign: 0.5}));
        button.set_child(content);
        button.set_tooltip_text(THEME_NAMES[swatch.key]);
        button.connect('clicked', () => {
            if (hasAccent && iface)
                iface.set_string('accent-color', swatch.key);
            else
                ext?.set_string('theme', {purple: 'lavender', green: 'sage', blue: 'ocean', orange: 'terracotta'}[swatch.key] ?? 'lavender');
            toast(_('Palette: %s').format(THEME_NAMES[swatch.key]));
        });
        buttons.set(swatch.key, button);
        flow.append(button);
    }
    const sync = () => {
        name.set_label(THEME_NAMES[palette.key]);
        for (const [key, button] of buttons) {
            if (key === palette.key)
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
    };
    palette.onChange(sync);
    sync();

    const dark = customSwitch({
        title: _('Dark style'),
        sub: _('Use the dark color scheme across the system'),
        icon: 'dark_mode',
        get: () => gs.get(IFACE, 'color-scheme') === 'prefer-dark',
        set: value => gs.set(IFACE, 'color-scheme', value ? 'prefer-dark' : 'default'),
    });
    gs.settings(IFACE)?.connect('changed::color-scheme', () =>
        dark.setActive(gs.get(IFACE, 'color-scheme') === 'prefer-dark'));

    return [card(head, flow), listCard([dark])];
}

/** Wallpapers found on disk, listed without blocking (one directory per idle turn). */
function findWallpapers(done) {
    const found = [];
    const dirs = [...WALLPAPER_DIRS];
    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
    if (pictures)
        dirs.push(pictures);
    const scan = (dir, depth) => {
        try {
            const enumerator = Gio.File.new_for_path(dir).enumerate_children(
                'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) && found.length < 24) {
                const path = GLib.build_filenamev([dir, info.get_name()]);
                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                    if (depth > 0)
                        scan(path, depth - 1);
                } else if (IMAGE.test(info.get_name())) {
                    found.push(GLib.filename_to_uri(path, null));
                }
            }
            enumerator.close(null);
        } catch {
            // Missing or unreadable directory.
        }
    };
    const step = () => {
        const dir = dirs.shift();
        if (!dir) {
            done(found);
            return;
        }
        scan(dir, 1);
        later(step);
    };
    later(step);
}

function wallpaperCard() {
    if (!gs.has(BG, 'picture-uri'))
        return null;
    const dark = () => palette.dark && gs.has(BG, 'picture-uri-dark');
    const current = () => gs.get(BG, dark() ? 'picture-uri-dark' : 'picture-uri', '');

    const holder = vbox(12);
    holder.append(label(_('Background'), 'm3-row-title'));

    const preview = new Gtk.Box();
    preview.set_size_request(-1, 150);
    preview.add_css_class('m3-thumb');
    preview.overflow = Gtk.Overflow.HIDDEN;
    let previewPicture = null;
    const showCurrent = () => {
        const uri = current();
        if (previewPicture)
            preview.remove(previewPicture);
        previewPicture = uri ? thumbnail(uri, 480, 150) : null;
        if (previewPicture) {
            previewPicture.hexpand = true;
            preview.append(previewPicture);
        }
    };
    holder.append(preview);

    const actions = hbox(8);
    actions.append(pillButton(_('Choose image...'), () => {
        const filter = new Gtk.FileFilter();
        filter.add_mime_type('image/*');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const chooser = new Gtk.FileDialog({title: _('Choose a background'), filters});
        chooser.open(getMainWindow(), null, (source, res) => {
            try {
                apply(source.open_finish(res).get_uri());
            } catch {
                // Dismissed.
            }
        });
    }, {icon: 'image', variant: 'tonal'}));
    holder.append(actions);

    const apply = uri => {
        gs.set(BG, 'picture-uri', uri);
        gs.set(BG, 'picture-uri-dark', uri);
        toast(_('Background changed'));
    };

    const strip = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        min_children_per_line: 2,
        max_children_per_line: 6,
        column_spacing: 8,
        row_spacing: 8,
    });
    holder.append(strip);
    const buttons = new Map();
    const markActive = () => {
        for (const [uri, button] of buttons) {
            if (uri === current())
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
    };

    const watch = () => {
        showCurrent();
        markActive();
    };
    gs.settings(BG).connect('changed::picture-uri', watch);
    gs.settings(BG).connect('changed::picture-uri-dark', watch);
    palette.onChange(watch);
    showCurrent();

    // Only filled in once the page is up.
    holder.fill = () => findWallpapers(uris => {
        for (const uri of uris.slice(0, 12)) {
            const button = new Gtk.Button();
            button.add_css_class('m3-wall');
            const picture = thumbnail(uri, 120, 76);
            picture.overflow = Gtk.Overflow.HIDDEN;
            button.set_child(picture);
            button.connect('clicked', () => apply(uri));
            buttons.set(uri, button);
            strip.append(button);
        }
        markActive();
    });
    return holder;
}

/** Icon and cursor themes installed on this system (listed lazily). */
function themeNames(kind) {
    const dirs = ['/usr/share/icons', GLib.build_filenamev([GLib.get_user_data_dir(), 'icons']),
        GLib.build_filenamev([GLib.get_home_dir(), '.icons'])];
    const names = new Set();
    for (const dir of dirs) {
        try {
            const enumerator = Gio.File.new_for_path(dir).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                const base = GLib.build_filenamev([dir, info.get_name()]);
                const isCursor = GLib.file_test(GLib.build_filenamev([base, 'cursors']), GLib.FileTest.IS_DIR);
                const hasIndex = GLib.file_test(GLib.build_filenamev([base, 'index.theme']), GLib.FileTest.EXISTS);
                if (hasIndex && (kind === 'cursor' ? isCursor : !isCursor))
                    names.add(info.get_name());
            }
            enumerator.close(null);
        } catch {
            // Directory missing.
        }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
}

/** Build `fn` into `box` on a later idle turn, so the page can paint between sections. */
function defer(box, fn, delay = 0) {
    GLib.timeout_add(GLib.PRIORITY_LOW, delay, () => {
        try {
            fn(box);
        } catch (e) {
            console.error(`material3 appearance: ${e.message}`);
        }
        return GLib.SOURCE_REMOVE;
    });
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Appearance'), _('Dynamic color, background, text size and animations')));

    const colors = vbox(16);
    const wallpaper = vbox(16);
    const tuning = vbox(16);
    const fonts = vbox(16);
    [colors, wallpaper, tuning, fonts].forEach(box => page.append(box));

    let wall = null;
    let iconTheme = null;
    let cursorTheme = null;

    paletteCard().forEach(widget => colors.append(widget));

    defer(wallpaper, box => {
        wall = wallpaperCard();
        if (wall)
            box.append(card(wall));
    }, 60);

    defer(tuning, box => {
        const ext = extSettings();
        const blocks = [];
        const text = gsSlider({
            schema: IFACE, key: 'text-scaling-factor', title: _('Text size'),
            caption: _('Changes the size of text in every app'),
            min: 85, max: 150, step: 5, scale: 100, discrete: true,
            leftIcon: 'text_decrease', rightIcon: 'text_increase',
            format: v => `${Math.round(v)}%`,
        });
        if (text)
            blocks.push(text);
        if (ext) {
            const labelFor = v => (v === 0 ? _('Off') : `${v}x`);
            const anim = sliderBlock({
                title: _('Animation speed'),
                min: 0, max: 2, step: 0.5, value: ext.get_double('anim-scale'), discrete: true,
                leftIcon: 'slow_motion_video', rightIcon: 'speed', format: labelFor,
                onChange: v => {
                    ext.set_double('anim-scale', v);
                    gs.set(IFACE, 'enable-animations', v > 0);
                },
            });
            ext.connect('changed::anim-scale', () => anim.setValue(ext.get_double('anim-scale')));
            blocks.push(anim.widget);
        }
        if (blocks.length)
            box.append(card(...blocks));
    }, 120);

    defer(fonts, box => {
        box.append(sectionLabel(_('Fonts and themes')));
        iconTheme = gsSelect({schema: IFACE, key: 'icon-theme', title: _('Icon theme'), icon: 'interests',
            options: []});
        cursorTheme = gsSelect({schema: IFACE, key: 'cursor-theme', title: _('Cursor theme'), icon: 'near_me',
            options: []});
        box.append(listCard([
            ...rowsFrom([
                {t: 'select', schema: IFACE, key: 'cursor-size', title: _('Cursor size'), icon: 'mouse',
                    options: [24, 32, 48, 64, 96].map(v => [v, `${v}`])},
            ]),
            iconTheme,
            cursorTheme,
            gsFont({schema: IFACE, key: 'font-name', title: _('Interface font'), icon: 'text_fields'}),
            gsFont({schema: IFACE, key: 'document-font-name', title: _('Document font'), icon: 'description'}),
            gsFont({schema: IFACE, key: 'monospace-font-name', title: _('Monospace font'), icon: 'code'}),
        ]));
        if (hasCommand('gnome-extensions')) {
            box.append(listCard([row({
                title: _('Dock and app menu'),
                sub: _('Size, behavior, categories and fonts of the dock, app menu and Quick Settings'),
                icon: 'dock_to_bottom',
                trailing: pillButton(_('Open'), () => {
                    GLib.spawn_command_line_async('gnome-extensions prefs material3@local');
                }, {variant: 'tonal'}),
            })]));
        }
    }, 180);

    // Wallpaper thumbnails and theme lists wait until the rest is on screen.
    page.refresh = () => {
        if (page._filled)
            return;
        page._filled = true;
        GLib.timeout_add(GLib.PRIORITY_LOW, 700, () => {
            wall?.fill?.();
            for (const [line, kind] of [[iconTheme, 'icon'], [cursorTheme, 'cursor']]) {
                if (!line)
                    continue;
                const names = themeNames(kind);
                const current = gs.get(IFACE, kind === 'icon' ? 'icon-theme' : 'cursor-theme');
                line.picker.setOptions(names.map(n => ({id: n, label: n})), current);
            }
            return GLib.SOURCE_REMOVE;
        });
    };
    return page;
}
