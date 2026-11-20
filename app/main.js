// Material 3 Settings: a real GTK 4 window (so the compositor tiles, snaps and
// resizes it), styled after the reference and backed by the same GSettings
// keys and system services as GNOME Settings.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {_, initTranslations} from './i18n.js';
import {extSettings, later} from './sys.js';
import {palette} from './theme.js';
import {PAGES, PANEL_ALIASES, groups} from './pages/index.js';
import {
    createToast, hbox, icon, label, note, setMainWindow, spinnerRow, vbox,
} from './ui.js';

// The default GSK renderer can stall for seconds compiling shaders on first use.
if (!GLib.getenv('GSK_RENDERER'))
    GLib.setenv('GSK_RENDERER', 'ngl', false);

const SMALL_WIDTH = 64;
const APP_ID = 'io.github.material3.Settings';

const SettingsWindow = GObject.registerClass(class M3SettingsWindow extends Gtk.ApplicationWindow {
    _init(application) {
        super._init({
            application,
            title: _('Settings'),
            default_width: 980,
            default_height: 700,
        });
        this.add_css_class('m3');
        this.set_size_request(560, 420);
        setMainWindow(this);

        this._pages = new Map();
        this._current = null;
        this._nav = new Map();
        this._groupHeads = [];

        this.set_titlebar(this._buildHeader());
        this.connect('map', () => {
            this._painted = true;
        });

        const overlay = new Gtk.Overlay();
        const body = hbox(0);
        this._sidebar = this._buildSidebar();
        this._sidebar.hexpand = false;
        this._sidebar.overflow = Gtk.Overflow.HIDDEN;
        body.append(this._sidebar);
        this._handle = this._buildHandle();
        body.append(this._handle);
        this._attachDrag(body);
        this._stack = new Gtk.Stack({
            hexpand: true,
            vexpand: true,
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 140,
        });
        this._stack.add_css_class('m3-content');
        body.append(this._stack);
        overlay.set_child(body);
        this._initStyle();
        this._initSidebarWidth();
        overlay.add_overlay(createToast());
        this.set_child(overlay);
    }

    _buildHeader() {
        const header = new Gtk.HeaderBar({show_title_buttons: false});
        header.add_css_class('m3-head');
        header.set_show_title_buttons(false);

        const toggle = new Gtk.Button();
        toggle.add_css_class('m3-icon');
        toggle.set_child(icon('menu', {size: 18}));
        toggle.set_tooltip_text(_('Show or hide the sidebar'));
        toggle.connect('clicked', () => {
            this._sidebar.visible = !this._sidebar.visible;
            this._handle.visible = this._sidebar.visible;
        });
        toggle.valign = Gtk.Align.CENTER;
        header.pack_start(toggle);

        const title = hbox(10);
        title.margin_start = 8;
        const mark = new Gtk.CenterBox();
        mark.add_css_class('m3-appicon');
        mark.set_size_request(24, 24);
        mark.set_center_widget(icon('settings', {size: 14, fill: true}));
        title.append(mark);
        title.append(label(_('Settings'), 'm3-wintitle'));
        title.valign = Gtk.Align.CENTER;
        header.pack_start(title);
        header.set_title_widget(new Gtk.Box());

        const control = (name, tooltip, onClick) => {
            const button = new Gtk.Button({valign: Gtk.Align.CENTER});
            button.add_css_class('m3-wc');
            const dot = new Gtk.CenterBox({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
            dot.add_css_class('m3-wc-dot');
            dot.set_size_request(28, 28);
            const glyph = icon(name, {size: 16});
            dot.set_center_widget(glyph);
            button.set_child(dot);
            button.set_tooltip_text(tooltip);
            button.connect('clicked', onClick);
            button.glyph = glyph;
            return button;
        };
        const minimize = control('remove', _('Minimize'), () => this.minimize());
        const maximize = control('check_box_outline_blank', _('Maximize'), () => {
            if (this.is_maximized())
                this.unmaximize();
            else
                this.maximize();
        });
        const close = control('close', _('Close'), () => this.close());
        close.add_css_class('close');
        this.connect('notify::maximized', () => {
            maximize.glyph.set_label(this.maximized ? 'filter_none' : 'check_box_outline_blank');
        });
        header.pack_end(close);
        header.pack_end(maximize);
        header.pack_end(minimize);
        return header;
    }

    _buildSidebar() {
        const side = vbox(0, 'm3-sidebar');
        side.set_size_request(SMALL_WIDTH, -1);
        this._wrap = null;
        this._navLabels = [];

        const wrap = new Gtk.Overlay();
        wrap.add_css_class('m3-search-wrap');
        this._search = new Gtk.Entry({placeholder_text: _('Search settings'), width_chars: 1, hexpand: true});
        this._search.add_css_class('m3-search');
        wrap.set_child(this._search);
        const glass = icon('search', {size: 18});
        glass.add_css_class('m3-search-icon');
        glass.halign = Gtk.Align.START;
        glass.valign = Gtk.Align.CENTER;
        glass.can_target = false;
        wrap.add_overlay(glass);
        this._wrap = wrap;
        side.append(wrap);
        this._search.connect('changed', () => this._filter());
        this._search.connect('activate', () => {
            const first = [...this._nav].find(([, button]) => button.visible);
            if (first)
                this.select(first[0]);
        });

        const list = vbox(0);
        list.margin_bottom = 12;
        for (const group of groups()) {
            const head = label(group.title.toUpperCase(), 'm3-group');
            list.append(head);
            const items = [];
            const groupBox = vbox(0, 'm3-navgroup');
            list.append(groupBox);
            for (const id of group.pages) {
                const page = PAGES[id];
                const button = new Gtk.Button();
                button.add_css_class('m3-nav');
                const line = hbox(12);
                const badge = new Gtk.CenterBox({valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER});
                badge.add_css_class('m3-navbadge');
                badge.add_css_class(`tone-${page.tone ?? 'gray'}`);
                badge.set_center_widget(icon(page.icon, {size: 20, fill: true}));
                line.append(badge);
                const text = vbox(0);
                text.hexpand = true;
                text.valign = Gtk.Align.CENTER;
                text.append(label(page.title(), 'm3-navtitle', {ellipsize: true}));
                text.append(label(page.sub?.() ?? '', 'm3-navsub', {ellipsize: true}));
                line.append(text);
                this._navLabels.push(text);
                button.set_tooltip_text(page.title());
                button._line = line;
                button.set_child(line);
                button.connect('clicked', () => this.select(id));
                this._nav.set(id, button);
                items.push(button);
                groupBox.append(button);
            }
            this._groupHeads.push({head, items});
        }
        const scroll = new Gtk.ScrolledWindow({
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            child: list,
        });
        side.append(scroll);
        return side;
    }

    // ---- sidebar: three locked widths (full = half the window, medium = a quarter, small = icons) --

    _stops() {
        const width = Math.max(this.get_width() || 980, 560);
        return [SMALL_WIDTH, Math.round(width * 0.25), Math.round(width * 0.5)];
    }

    _initSidebarWidth() {
        const saved = extSettings();
        const mode = saved?.settings_schema.has_key('settings-sidebar-mode')
            ? saved.get_int('settings-sidebar-mode') : 2;
        this._mode = Math.max(0, Math.min(2, mode));
        this._width = this._stops()[this._mode];
        this._sidebar.set_size_request(this._width, -1);
        if (this._mode === 0)
            this._compact(true);
        let lastWindow = 0;
        this.add_tick_callback(() => {
            const w = this.get_width();
            if (w !== lastWindow) {
                lastWindow = w;
                if (!this._anim && w > 0)
                    this._applyWidth(this._stops()[this._mode]);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _applyWidth(width) {
        this._width = width;
        this._sidebar.set_size_request(Math.max(SMALL_WIDTH, Math.round(width)), -1);
    }

    /** Animate the sidebar to a mode (0 small, 1 medium, 2 full). */
    _goMode(mode) {
        if (mode === this._mode && !this._anim)
            return;
        this._mode = mode;
        if (mode > 0)
            this._compact(false);
        const from = this._width;
        const to = this._stops()[mode];
        const start = this._animStart = GLib.get_monotonic_time();
        const duration = 200000;
        this._anim?.();
        let id = 0;
        const stop = () => {
            if (id)
                this.remove_tick_callback(id);
            id = 0;
            this._anim = null;
        };
        this._anim = stop;
        id = this.add_tick_callback(() => {
            if (this._animStart !== start)
                return GLib.SOURCE_REMOVE;
            const t = Math.min(1, (GLib.get_monotonic_time() - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            this._applyWidth(from + (to - from) * eased);
            if (t >= 1) {
                this._anim = null;
                id = 0;
                if (this._mode === 0)
                    this._compact(true);
                this._saveMode();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _saveMode() {
        const saved = extSettings();
        if (saved?.settings_schema.has_key('settings-sidebar-mode') && saved.get_int('settings-sidebar-mode') !== this._mode)
            saved.set_int('settings-sidebar-mode', this._mode);
    }

    _buildHandle() {
        const handle = new Gtk.Box();
        handle.add_css_class('m3-handle');
        handle.set_size_request(6, -1);
        handle.set_cursor_from_name('col-resize');
        this._handleBox = handle;
        return handle;
    }

    /**
     * Drag on the layout (not on the handle itself, which moves with the
     * sidebar and would make the offset jitter): the sidebar trails the
     * pointer with some lag, and settles on the nearest mode on release.
     */
    _attachDrag(body) {
        const drag = new Gtk.GestureDrag();
        let startWidth = 0;
        let target = 0;
        let follow = 0;
        const stopFollow = () => {
            if (follow)
                this.remove_tick_callback(follow);
            follow = 0;
        };
        drag.connect('drag-begin', (gesture, x, y) => {
            const hit = body.pick(x, y, Gtk.PickFlags.DEFAULT);
            if (!this._sidebar.visible || !hit || !(hit === this._handleBox || hit.is_ancestor(this._handleBox))) {
                gesture.set_state(Gtk.EventSequenceState.DENIED);
                return;
            }
            this._anim?.();
            this._animStart = null;
            startWidth = this._width;
            target = startWidth;
            stopFollow();
            follow = this.add_tick_callback(() => {
                this._applyWidth(this._width + (target - this._width) * 0.28);
                this._compact(this._width < 110);
                return GLib.SOURCE_CONTINUE;
            });
        });
        drag.connect('drag-update', (_g, offsetX) => {
            const stops = this._stops();
            target = Math.max(stops[0], Math.min(stops[2], startWidth + offsetX));
        });
        drag.connect('drag-end', () => {
            if (!follow)
                return;
            stopFollow();
            const stops = this._stops();
            let best = 0;
            stops.forEach((stop, index) => {
                if (Math.abs(stop - target) < Math.abs(stops[best] - target))
                    best = index;
            });
            this._mode = -1;
            this._goMode(best);
        });
        body.add_controller(drag);
    }

    /** Icon-only sidebar when dragged narrow. */
    _compact(on) {
        if (this._compactOn === on)
            return;
        this._compactOn = on;
        this._wrap.visible = !on;
        this._navLabels.forEach(text => {
            text.visible = !on;
        });
        for (const [, button] of this._nav) {
            button._line.halign = on ? Gtk.Align.CENTER : Gtk.Align.FILL;
            if (on)
                button.add_css_class('compact');
            else
                button.remove_css_class('compact');
        }
        if (on)
            this._sidebar.add_css_class('compact');
        else
            this._sidebar.remove_css_class('compact');
        this._updateHeads();
        if (!on)
            this._filter();
    }

    _updateHeads() {
        for (const {head, items} of this._groupHeads)
            head.visible = this._navStyle === 'pills' && !this._compactOn && items.some(button => button.visible);
    }

    /** Sidebar button style (an extension option): cards or pills. */
    _initStyle() {
        const ext = extSettings();
        const ok = ext?.settings_schema.has_key('settings-sidebar-style');
        const read = () => {
            this._navStyle = ok && ext.get_string('settings-sidebar-style') === 'pills' ? 'pills' : 'cards';
            this._sidebar.remove_css_class('style-cards');
            this._sidebar.remove_css_class('style-pills');
            this._sidebar.add_css_class(`style-${this._navStyle}`);
            this._updateHeads();
        };
        read();
        if (ok)
            ext.connect('changed::settings-sidebar-style', read);
    }

    _filter() {
        const query = this._search.text.toLowerCase().trim();
        for (const [id, button] of this._nav) {
            const page = PAGES[id];
            button.visible = !query || `${page.title()} ${page.keywords}`.toLowerCase().includes(query);
        }
        this._updateHeads();
    }

    /** Show a page (built the first time it is needed). */
    select(id) {
        if (!PAGES[id])
            id = 'appearance';
        for (const [key, button] of this._nav) {
            if (key === id)
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
        if (this._current === id) {
            this._pages.get(id)?.page?.refresh?.();
            return;
        }
        this._current = id;

        let entry = this._pages.get(id);
        if (!entry) {
            // The shell paints right away; the page is built a moment later.
            const holder = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
            holder.add_css_class('m3-page');
            holder.append(spinnerRow(_('Loading...')));
            const scroll = new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vexpand: true,
                hexpand: true,
                child: holder,
            });
            entry = {scroll, holder, page: null};
            this._pages.set(id, entry);
            this._stack.add_named(scroll, id);
            // Wait for the first frame so the window opens instantly.
            GLib.timeout_add(GLib.PRIORITY_LOW, this._painted ? 0 : 150, () => {
                this._build(id, entry);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            entry.page?.refresh?.();
        }
        this._stack.set_visible_child_name(id);
    }

    async _build(id, entry) {
        let page;
        try {
            const module = await import(`./pages/${PAGES[id].file}.js`);
            page = module.build();
        } catch (e) {
            console.error(`material3 settings: page ${id} failed: ${e.message}\n${e.stack}`);
            page = vbox(12);
            page.append(label(PAGES[id].title(), 'm3-title'));
            page.append(note(`${_('This page could not be loaded')}: ${e.message}`, 'error'));
        }
        let child = entry.holder.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            entry.holder.remove(child);
            child = next;
        }
        entry.holder.spacing = 16;
        entry.holder.append(page);
        entry.page = page;
        page.refresh?.();
    }
});

const SettingsApp = GObject.registerClass(class M3SettingsApp extends Gtk.Application {
    _init() {
        super._init({
            application_id: APP_ID,
            flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
        });
        this._window = null;
    }

    vfunc_startup() {
        super.vfunc_startup();
        initTranslations();
        palette.start();
    }

    vfunc_command_line(commandLine) {
        const args = commandLine.get_arguments().slice(1).filter(a => !a.startsWith('-'));
        this._show(args[0] ?? null);
        return 0;
    }

    vfunc_activate() {
        this._show(null);
    }

    _show(panel) {
        if (!this._window) {
            this._window = new SettingsWindow(this);
            this._window.connect('close-request', () => {
                this._window = null;
                return false;
            });
            this._window.select(PANEL_ALIASES[panel] ?? 'appearance');
        } else if (panel) {
            this._window.select(PANEL_ALIASES[panel] ?? panel);
        }
        this._window.present();
    }
});

const app = new SettingsApp();
app.run([System.programInvocationName, ...(System.programArgs ?? [])]);
