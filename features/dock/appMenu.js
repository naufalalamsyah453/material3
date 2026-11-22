import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from '../../i18n.js';
import {activateApp} from '../settings/launcher.js';

import {px, scoped} from '../quickSettings/ui.js';
import {centerBin, iconButton, pressFeedback, styleSymbol, symbolIcon, textLabel} from '../quickSettings/widgets.js';
import {installedApps, tintClass} from './apps.js';
import {ContextMenu, appContextItems, watchOutsidePress} from './contextMenu.js';

// The shell may never deliver the Super (Windows) key to the menu while it
// holds the modal grab (it is consumed as the "overlay key"), so the
// modifier state itself is polled for a press.
const SUPER_MASK = (Clutter.ModifierType.SUPER_MASK ?? 0) | (Clutter.ModifierType.MOD4_MASK ?? 0);
const SUPER_POLL_MS = 20;

const MENU_WIDTH = 480;
const MENU_WIDTH_RANGE = {min: 360, max: 900};
const COLUMNS = 4;
// Menu width - 2*16 (panel) - 2*10 (grid card) - 3*8 (gaps), over four columns:
// 100 at the default 480.
const CARD_CHROME = 2 * 16 + 2 * 10 + 3 * 8;

/** Power profile shown on the header button, by profile id. */
const POWER_ICONS = {
    'performance': 'bolt',
    'balanced': 'balance',
    'power-saver': 'eco',
};
// Cards built up front (the rest follow in idle slices) and animated on open.
const FIRST_CARDS = COLUMNS * 4;
const SLICE_CARDS = COLUMNS * 2;
const ANIMATED_CARDS = COLUMNS * 2;

/**
 * The reference app drawer: a popover above the dock with a header, search
 * pill, category pills, a four-column app grid and a "continue" card.
 */
export class AppMenu {
    /**
     * @param {object} host
     * @param {function(): void} host.cycleTheme
     * @param {function(): void} host.toggleDark
     * @param {function(boolean): void} host.openChanged
     * @param {function(): number} host.listHeight height of the app grid in px
     * @param {function(): number} [host.menuWidth] width of the menu in px
     * @param {object} [host.power] PowerBackend, for the power mode button
     * @param {function(): boolean} host.showRecent whether the recent window card shows
     * @param {function(): string} host.userName name shown in the header
     * @param {function(): {list: object[], custom: object[], favorite: string|null}} host.categoryConfig
     *   visible category pills, custom categories and the favorite category
     */
    constructor(host) {
        this._host = host;
        this.isOpen = false;
        this._category = 'all';
        this._apps = [];
        // Which part of the app list `_apps` holds: 'all', or one category id
        // (favorite mode loads only that category on the first open).
        this._scope = '';
        this._config = {list: [], custom: [], favorite: null};
        this._configKey = '';
        this._shown = [];
        this._suggestion = null;

        this._modal = null;
        this._stopWatching = null;

        const width = host.menuWidth?.() ?? MENU_WIDTH;
        this._menuWidth = Math.max(MENU_WIDTH_RANGE.min, Math.min(MENU_WIDTH_RANGE.max, width));
        this._cardWidth = Math.floor((this._menuWidth - CARD_CHROME) / COLUMNS);
        this._powerUnsub = null;

        // Cards are built once per app and reused; the app list is only
        // re-read when the installed apps change.
        this._cards = new Map();
        this._appsDirty = true;
        this._appsVersion = 0;
        this._renderKey = '';
        this._fillId = 0;
        this._animateCards = false;
        this._installedId = Shell.AppSystem.get_default().connect('installed-changed', () => {
            this._appsDirty = true;
        });

        scoped('menu', () => this._build());
    }

    _build() {
        // `m3-qs` (+ light/dark, set by the feature) puts the palette rules
        // in scope. The panel inside is what animates.
        this.actor = new St.Widget({
            style_class: 'm3-qs',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            reactive: true,
        });

        this._panel = new St.BoxLayout({
            style_class: 'm3-appmenu',
            orientation: Clutter.Orientation.VERTICAL,
            width: px(this._menuWidth),
        });
        this._panel.set_pivot_point(0.5, 1);
        this.actor.add_child(this._panel);

        this._panel.add_child(this._buildHeader());
        this._panel.add_child(this._buildSearch());
        this._panel.add_child(this._buildCategories());
        this._panel.add_child(this._buildGrid());
        this._suggest = this._buildSuggestion();
        this._panel.add_child(this._suggest);

        // Hosts the right-click menu over the panel (inside the modal grab).
        this._overlay = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        this.actor.add_child(this._overlay);
        // The overlay must not grow with the right-click menu inside it: that
        // would stretch this actor and move the panel. It always matches the panel.
        const fitOverlay = () => this._overlay.set_size(this._panel.width, this._panel.height);
        this._panel.connect('notify::width', fitOverlay);
        this._panel.connect('notify::height', fitOverlay);
        this._ctx = new ContextMenu({container: this._overlay, grabHost: this.actor});

        this.actor.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Super_L || key === Clutter.KEY_Super_R) {
                this._closeForSuper('menu key');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /**
     * True right after the menu was closed by the Super key. The shell may
     * still report that same key press (on release) as the overlay key,
     * which would otherwise reopen the menu immediately.
     */
    /** Header text: the computer's user (as chosen in the settings) and login@host. */
    _syncHeader() {
        const user = GLib.get_user_name();
        const name = this._host.userName?.() || user;
        this._headTitle.set_text(name);
        this._headSub.set_text(`${user}@${GLib.get_host_name()}`);
    }

    /** @returns {boolean} whether a Super key is physically down right now. */
    _superHeld() {
        try {
            const [, , mods] = global.get_pointer();
            return (mods & SUPER_MASK) !== 0;
        } catch {
            return false;
        }
    }

    /**
     * Close because the Super (Windows) key was pressed.
     *
     * @param {string} via which detector noticed it (for the log)
     */
    _closeForSuper(via = 'key') {
        if (!this.isOpen)
            return;
        console.log(`material3: app menu closed by Super (${via})`);
        this._superClosedAt = GLib.get_monotonic_time();
        this.close();
        this._watchSuperRelease();
    }

    /**
     * Keep track of the Super key until it is let go: the shell can report
     * that same press as the overlay key on release, which would reopen
     * the menu through the dock's toggle.
     */
    _watchSuperRelease() {
        if (this._superWatchId)
            GLib.source_remove(this._superWatchId);
        this._superReleasedAt = 0;
        let ticks = 0;
        this._superWatchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SUPER_POLL_MS, () => {
            if (this._superHeld() && ++ticks < 250)
                return GLib.SOURCE_CONTINUE;
            this._superWatchId = 0;
            this._superReleasedAt = GLib.get_monotonic_time();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * True while, or just after, the Super key that closed the menu is still
     * down, so its echo is not taken as a request to open the menu again.
     */
    justClosedBySuper() {
        if (!this._superClosedAt)
            return false;
        if (this._superWatchId)
            return true;
        return GLib.get_monotonic_time() - this._superReleasedAt < 400000;
    }

    _buildHeader() {
        const head = new St.BoxLayout({style_class: 'm3-appmenu-head'});

        const left = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(10)}px;`,
        });
        left.add_child(centerBin(
            symbolIcon('person', {size: 18, filled: true}),
            'm3-appmenu-head-tile',
            {width: px(32), height: px(32)}));

        const labels = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headTitle = textLabel('', 'm3-appmenu-title');
        this._headSub = textLabel('', 'm3-appmenu-subtitle');
        labels.add_child(this._headTitle);
        labels.add_child(this._headSub);
        left.add_child(labels);
        this._syncHeader();
        head.add_child(left);

        const actions = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(6)}px;`,
        });

        const headerButton = 'theme';
        if (headerButton === 'theme') {
            const theme = new St.Button({
                style_class: 'm3-appmenu-pill',
                accessible_name: _('Switch Palette'),
                height: px(32),
                can_focus: true,
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const themeContent = new St.BoxLayout({style: `spacing: ${px(4)}px;`});
            themeContent.add_child(symbolIcon('palette', {size: 15, filled: true}));
            themeContent.add_child(textLabel(_('Theme'), 'm3-appmenu-pill-text'));
            theme.set_child(themeContent);
            pressFeedback(theme);
            theme.connect('clicked', () => this._host.cycleTheme());
            actions.add_child(theme);
        }

        // Power mode: a button popping up the
        // available profiles (Performance, Balanced, Power Saver).
        this._powerBtn = iconButton('balance', {size: 17, buttonSize: 32});
        this._powerBtn.accessible_name = _('Power Mode');
        this._powerBtn.connect('clicked', () => this._showPowerMenu());
        actions.add_child(this._powerBtn);
        const power = this._host.power;
        if (power)
            this._powerUnsub = power.subscribe(() => this._syncPower());
        this._syncPower();

        const contrast = iconButton('contrast', {size: 17, buttonSize: 32});
        contrast.accessible_name = _('Toggle Light/Dark Mode');
        contrast.connect('clicked', () => this._host.toggleDark());
        actions.add_child(contrast);

        head.add_child(actions);
        return head;
    }

    _buildSearch() {
        const search = new St.Widget({
            style_class: 'm3-appmenu-search',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });

        this._entry = new St.Entry({
            style_class: 'm3-text m3-appmenu-entry',
            hint_text: _('Search apps, tools, or settings...'),
            can_focus: true,
            x_expand: true,
            height: px(44),
        });

        // The search icon and the clear button are the entry's own icons, so
        // they sit at its ends and the text never runs under them.
        const icon = symbolIcon('search', {size: 19});
        this._entry.set_primary_icon(icon);

        this._clear = new St.Button({
            style_class: 'm3-appmenu-clear',
            accessible_name: _('Clear Search'),
            width: px(28),
            height: px(28),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clear.set_child(centerBin(symbolIcon('close', {size: 16}), 'm3-appmenu-clear-inner'));
        this._clear.connect('clicked', () => {
            this._entry.set_text('');
            this._entry.grab_key_focus();
        });

        const text = this._entry.clutter_text;
        text.connect('text-changed', () => {
            this._syncClear();
            this._render();
            this._restartCaret();
        });
        text.connect('activate', () => {
            if (this._shown[0])
                this._launch(this._shown[0]);
        });
        search.add_child(this._entry);
        this._syncClear();

        return search;
    }

    /**
     * Blink the caret ourselves: the shell's own blink is off for an entry
     * inside a modal grab. It stays solid while typing.
     */
    _startCaret() {
        this._stopCaret();
        const text = this._entry.clutter_text;
        let visible = true;
        text.cursor_visible = true;
        this._caretId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 530, () => {
            visible = !visible;
            text.cursor_visible = visible;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _restartCaret() {
        if (this._caretId)
            this._startCaret();
    }

    _stopCaret() {
        if (this._caretId)
            GLib.source_remove(this._caretId);
        this._caretId = 0;
        try {
            this._entry.clutter_text.cursor_visible = true;
        } catch {
            // The entry is already gone (menu destroyed).
        }
    }

    /** The clear button only exists while there is text to clear. */
    _syncClear() {
        const hasText = this._entry.get_text().length > 0;
        if (hasText && !this._entry.get_secondary_icon())
            this._entry.set_secondary_icon(this._clear);
        else if (!hasText && this._entry.get_secondary_icon())
            this._entry.set_secondary_icon(null);
    }

    _buildCategories() {
        // Scrolls sideways when there are more pills than fit.
        this._catScroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._catScroll.connect('scroll-event', (_actor, event) => {
            try {
                const adj = this._catScroll.get_hscroll_bar().get_adjustment();
                const dir = event.get_scroll_direction();
                const step = px(60);
                if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
                    adj.value -= step;
                else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
                    adj.value += step;
                else
                    return Clutter.EVENT_PROPAGATE;
                return Clutter.EVENT_STOP;
            } catch {
                return Clutter.EVENT_PROPAGATE;
            }
        });

        this._catBar = new St.BoxLayout({
            style_class: 'm3-appmenu-cats',
            style: `spacing: ${px(6)}px; margin-bottom: 0;`,
            x_expand: true,
        });
        this._catScroll.set_child(this._catBar);
        this._catButtons = new Map();
        this._rebuildCategories();

        // While searching, the pills give way to a result line of the same
        // height, so the menu does not change size.
        this._searchHint = textLabel('', 'm3-appmenu-searchhint', {
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchHint.opacity = 0;
        this._searchHint.reactive = false;

        this._catSlot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._catSlot.add_child(this._catScroll);
        this._catSlot.add_child(this._searchHint);

        // Round sort button after the pills.
        this._sortBtn = iconButton('sort', {size: 17, buttonSize: 32});
        this._sortBtn.accessible_name = _('Sort apps');
        this._sortBtn.y_align = Clutter.ActorAlign.CENTER;
        this._sortBtn.connect('clicked', () => this._showSortMenu());
        const row = new St.BoxLayout({x_expand: true, style: `spacing: ${px(8)}px; margin-bottom: ${px(12)}px;`});
        row.add_child(this._catSlot);
        row.add_child(this._sortBtn);
        return row;
    }

    /** Pills while browsing, a result line while searching. */
    _syncSearchMode(searching, count = 0) {
        if (searching)
            this._searchHint.set_text(`${_('Search results')} \u00b7 ${count}`);
        if (this._searching === searching)
            return;
        this._searching = searching;

        this._catScroll.reactive = !searching;
        for (const [actor, visible] of [[this._catScroll, !searching], [this._searchHint, searching]]) {
            actor.remove_all_transitions();
            actor.ease({
                opacity: visible ? 255 : 0,
                duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    /** (Re)create the category pills from the current configuration. */
    _rebuildCategories() {
        this._catBar.destroy_all_children();
        this._catButtons = new Map();

        // Pills always share the whole bar, however many there are; the bar
        // only scrolls when even their natural widths do not fit.
        for (const {id, label} of this._config.list) {
            const button = new St.Button({
                style_class: 'm3-appmenu-cat',
                can_focus: true,
                reactive: true,
                x_expand: true,
                child: centerBin(textLabel(label, 'm3-appmenu-cat-text'), 'm3-appmenu-cat-inner'),
            });
            pressFeedback(button);
            button.connect('clicked', () => this._setCategory(id));
            this._catButtons.set(id, button);
            this._catBar.add_child(button);
        }
        this._syncCategoryPills();
    }

    _buildGrid() {
        const wrap = new St.BoxLayout({
            style_class: 'm3-appmenu-gridwrap',
            orientation: Clutter.Orientation.VERTICAL,
        });

        const scroll = new St.ScrollView({
            style_class: 'm3-appmenu-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            // Fixed, not a maximum: the menu keeps its size whatever the
            // category or search result holds. A short list leaves empty
            // space, a long one scrolls.
            height: px(this._host.listHeight?.() ?? 240),
        });
        this._rows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${px(8)}px;`,
        });
        scroll.set_child(this._rows);
        wrap.add_child(scroll);
        return wrap;
    }

    _buildSuggestion() {
        const card = new St.BoxLayout({
            style_class: 'm3-appmenu-suggest',
            visible: false,
        });

        const left = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(10)}px;`,
        });
        left.add_child(centerBin(
            symbolIcon('description', {size: 17, filled: true}),
            'm3-appmenu-suggest-tile',
            {width: px(32), height: px(32)}));

        const labels = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        labels.add_child(textLabel(_('CONTINUE WHERE YOU LEFT OFF'), 'm3-appmenu-suggest-label'));
        this._suggestTitle = textLabel('', 'm3-appmenu-suggest-title');
        this._suggestTitle.clutter_text.set_single_line_mode(true);
        this._suggestTitle.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        labels.add_child(this._suggestTitle);
        left.add_child(labels);
        card.add_child(left);

        const open = new St.Button({
            style_class: 'm3-appmenu-open',
            accessible_name: _('Open'),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: textLabel(_('Open'), 'm3-appmenu-open-text'),
        });
        pressFeedback(open);
        this._openButton = open;
        open.connect('clicked', () => {
            const window = this._suggestion;
            this.close();
            if (window)
                Main.activateWindow(window);
        });
        card.add_child(open);
        return card;
    }

    /** Most recently used window, like the HTML's "last file". */
    _updateSuggestion() {
        let window = null;
        try {
            const normal = Meta.TabList?.NORMAL ?? 0;
            window = global.display.get_tab_list(normal, null)[0] ?? null;
        } catch (e) {
            console.error(`material3: app menu could not read recent windows: ${e.message}`);
        }
        this._suggestion = window;

        // The card keeps its slot even without a window (a placeholder is
        // shown), so the menu's height never depends on it.
        this._suggest.visible = this._host.showRecent?.() ?? true;
        this._suggestTitle.set_text(window
            ? (window.get_title() || _('Untitled'))
            : _('No windows yet'));
        this._openButton.reactive = !!window;
        this._openButton.can_focus = !!window;
        this._openButton.opacity = window ? 255 : 90;
    }

    _setCategory(id) {
        this._category = id;
        // Favorite mode only read one category up front; reading the rest is
        // deferred to the first time the user leaves it.
        if (this._scope !== 'all' && id !== this._scope)
            scoped('menu', () => this._loadApps('all'));
        this._syncCategoryPills();
        this._render();
    }

    /**
     * Read the installed apps of `scope` ('all' or one category id).
     *
     * @param {string} scope
     */
    _loadApps(scope) {
        try {
            this._apps = installedApps(this._config.custom, scope === 'all' ? null : scope);
            this._scope = scope;
        } catch (e) {
            console.error(`material3: app menu could not list apps: ${e.message}`);
            this._apps = [];
            this._scope = scope;
        }
        this._appsDirty = false;
        this._appsVersion++;

        // Drop cards of uninstalled apps (only knowable from a full read).
        if (scope === 'all') {
            const ids = new Set(this._apps.map(e => e.app.get_id()));
            for (const [id, card] of [...this._cards]) {
                if (!ids.has(id)) {
                    card.destroy();
                    this._cards.delete(id);
                }
            }
        }
    }

    _syncCategoryPills() {
        for (const [id, button] of this._catButtons) {
            if (id === this._category)
                button.add_style_class_name('active');
            else
                button.remove_style_class_name('active');
        }
    }

    _render() {
        scoped('menu', () => this._renderGrid());
    }

    _renderGrid() {
        const query = this._entry.get_text().toLowerCase().trim();
        const searching = query.length > 0;

        // A search looks through every app, whatever category is selected,
        // so a favorite-only first read is widened the moment one starts.
        if (searching && this._scope !== 'all')
            this._loadApps('all');

        const category = searching ? 'all' : this._category;
        const key = `${category}|${query}|${this._appsVersion}|${this._host.sortMode?.() ?? 'name'}`;
        if (key === this._renderKey) {
            this._syncSearchMode(searching, this._shown.length);
            return;
        }
        this._renderKey = key;

        const list = this._sorted(this._apps.filter(({cats, text}) =>
            (category === 'all' || cats.has(category)) &&
            (!query || text.includes(query))));
        this._syncSearchMode(searching, list.length);

        this._cancelFill();
        // Keep the cards (they are reused); only the rows are rebuilt.
        for (const row of this._rows.get_children())
            row.remove_all_children();
        this._rows.destroy_all_children();
        this._shown = list.map(e => e.app);

        if (list.length === 0) {
            const empty = new St.BoxLayout({
                style_class: 'm3-appmenu-empty',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            const icon = symbolIcon('search_off', {size: 34});
            icon.x_align = Clutter.ActorAlign.CENTER;
            empty.add_child(icon);
            const label = textLabel(_('No apps found'), 'm3-appmenu-empty-text');
            label.x_align = Clutter.ActorAlign.CENTER;
            empty.add_child(label);
            this._rows.add_child(empty);
            return;
        }

        // The first screenful now, the rest in idle slices: building every
        // card at once is what made opening the menu slow.
        this._fillList = list;
        this._fillNext = 0;
        this._fillRow = null;
        this._fill(FIRST_CARDS);
    }

    /** Add the next `count` cards; schedule the remainder. */
    _fill(count) {
        const list = this._fillList;
        const end = Math.min(list.length, this._fillNext + count);

        for (; this._fillNext < end; this._fillNext++) {
            const index = this._fillNext;
            if (index % COLUMNS === 0) {
                this._fillRow = new St.BoxLayout({style: `spacing: ${px(8)}px;`});
                this._rows.add_child(this._fillRow);
            }
            this._fillRow.add_child(this._card(list[index], index));
        }

        if (this._fillNext >= list.length) {
            this._fillList = null;
            this._fillRow = null;
            return;
        }

        this._fillId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._fillId = 0;
            scoped('menu', () => this._fill(SLICE_CARDS));
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelFill() {
        if (this._fillId)
            GLib.source_remove(this._fillId);
        this._fillId = 0;
        this._fillList = null;
        this._fillRow = null;
    }

    _card({app, index: tint}, position) {
        const id = app.get_id();
        let button = this._cards.get(id);
        if (button) {
            this._enter(button, position);
            return button;
        }

        button = new St.Button({
            style_class: 'm3-app-card',
            accessible_name: app.get_name(),
            can_focus: true,
            reactive: true,
            track_hover: true,
            width: px(this._cardWidth),
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${px(6)}px;`,
        });

        const icon = new St.Icon({gicon: app.get_icon(), icon_size: px(28)});
        box.add_child(centerBin(icon, `m3-app-tile ${tintClass(tint)}`, {
            width: px(48),
            height: px(48),
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const name = textLabel(app.get_name(), 'm3-app-name', {x_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.set_single_line_mode(true);
        name.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        // The card's width follows the menu width; the name must fit inside it.
        name.set_style(`max-width: ${px(this._cardWidth - 20)}px;`);
        box.add_child(name);

        button.set_child(box);
        pressFeedback(button, {scale: 0.93});
        button.connect('clicked', (_button, which) => {
            if (which === 3)
                this._showContext(app);
            else
                this._launch(app);
        });

        this._cards.set(id, button);
        this._enter(button, position);
        return button;
    }

    /** Reference `appItemEnter`: a short staggered rise, for the first cards on open only. */
    _enter(button, position) {
        button.remove_all_transitions();
        if (!this._animateCards || position >= ANIMATED_CARDS) {
            button.opacity = 255;
            button.translation_y = 0;
            return;
        }
        button.opacity = 0;
        button.translation_y = px(8);
        button.ease({
            opacity: 255,
            translation_y: 0,
            duration: 240,
            delay: position * 24,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
        });
    }

    /** Icon of the current power profile; hidden when power profiles are unavailable. */
    _syncPower() {
        const power = this._host.power;
        const available = !!power?.state.available;
        this._powerBtn.visible = available;
        if (!available)
            return;
        const symbol = this._powerBtn.get_child()?.get_child();
        symbol?.set_text(POWER_ICONS[power.profile] ?? 'balance');
    }

    /** Pop-up with the power profiles, under the power button. */
    _showPowerMenu() {
        const options = this._host.power?.options.getOptions().items ?? [];
        if (options.length === 0)
            return;

        const items = options.map(({icon, label, selected, activate}) => ({
            icon,
            label,
            selected,
            activate,
        }));
        const [x, y] = this._powerBtn.get_transformed_position();
        const [width, height] = this._powerBtn.get_transformed_size();
        this._ctx.open(items, {x: x + width, y: y + height + px(6), placement: 'below-end'});
    }

    _showSortMenu() {
        const current = this._host.sortMode?.() ?? 'name';
        const items = [
            ['name', 'sort_by_alpha', _('Name (A-Z)')],
            ['name-desc', 'sort_by_alpha', _('Name (Z-A)')],
            ['usage', 'history', _('Most used')],
        ].map(([id, icon, label]) => ({
            icon, label,
            selected: id === current,
            activate: () => {
                this._host.setSortMode?.(id);
                this._renderKey = null;
                this._render();
            },
        }));
        const [x, y] = this._sortBtn.get_transformed_position();
        const [width, height] = this._sortBtn.get_transformed_size();
        this._ctx.open(items, {x: x + width, y: y + height + px(6), placement: 'below-end'});
    }

    /** `list` ordered by the chosen sort mode (name A-Z is how it is read). */
    _sorted(list) {
        const mode = this._host.sortMode?.() ?? 'name';
        if (mode === 'name')
            return list;
        if (mode === 'name-desc')
            return [...list].reverse();
        try {
            const usage = Shell.AppUsage.get_default();
            return [...list].sort((a, b) => usage.compare(a.app.get_id(), b.app.get_id()));
        } catch {
            return list;
        }
    }

    /** Right-click menu of an app card, at the pointer. */
    _showContext(app) {
        const [x, y] = global.get_pointer();
        this._ctx.open(appContextItems(app, () => this.close()), {x, y, placement: 'pointer'});
    }

    _launch(app) {
        // No closing animation: it would compete with the app starting up.
        this.close(false);
        try {
            activateApp(app);
        } catch (e) {
            console.error(`material3: failed to launch ${app.get_name()}: ${e.message}`);
        }
    }

    /** @param {boolean} dark */
    setDark(dark) {
        this.actor.remove_style_class_name('m3-light');
        this.actor.remove_style_class_name('m3-dark');
        this.actor.add_style_class_name(dark ? 'm3-dark' : 'm3-light');
    }

    /**
     * @param {object} anchor where the popover sits
     * @param {number} anchor.centerX horizontal center (the dock's)
     * @param {number} anchor.bottomY lower edge (just above the dock)
     */
    open({centerX, bottomY}) {
        if (this.isOpen)
            return;

        try {
            this._open(centerX, bottomY);
        } catch (e) {
            console.error(`material3: app menu failed to open: ${e.message}\n${e.stack}`);
            this._releaseInput();
            this.isOpen = false;
            this.actor.hide();
            this._host.openChanged(false);
        }
    }

    _open(centerX, bottomY) {
        scoped('menu', () => this._openScoped(centerX, bottomY));
    }

    _openScoped(centerX, bottomY) {
        this._syncHeader();

        // Categories are read from settings on every open, so edits made in
        // the preferences window apply without rebuilding the menu.
        const config = this._host.categoryConfig?.() ?? this._config;
        const configKey = JSON.stringify(config);
        if (configKey !== this._configKey) {
            this._configKey = configKey;
            this._config = config;
            this._rebuildCategories();
            this._appsDirty = true;
        }

        // Favorite mode: open on the favorite category and read only it.
        const favorite = config.favorite;
        const wanted = favorite ?? 'all';
        if (this._appsDirty || (this._scope !== 'all' && this._scope !== wanted))
            this._loadApps(wanted);

        this._category = wanted;
        this._syncCategoryPills();
        this._searching = false;
        this._catScroll.remove_all_transitions();
        this._searchHint.remove_all_transitions();
        this._catScroll.opacity = 255;
        this._catScroll.reactive = true;
        this._searchHint.opacity = 0;
        this._entry.set_text('');
        this._syncClear();
        this._updateSuggestion();
        this._animateCards = true;
        this._render();
        this._animateCards = false;

        this.actor.show();
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);

        const monitor = Main.layoutManager.primaryMonitor;
        const [, width] = this._panel.get_preferred_width(-1);
        const [, height] = this._panel.get_preferred_height(width);
        const margin = px(12);
        const x = Math.max(monitor.x + margin,
            Math.min(centerX - width / 2, monitor.x + monitor.width - width - margin));
        const y = Math.max(monitor.y + margin, bottomY - height);
        this.actor.set_position(Math.round(x), Math.round(y));
        this._overlay.set_size(width, height);

        this.isOpen = true;
        this._grabInput();
        this._host.openChanged(true);

        // Reference `.app-drawer-panel`: scale .92 + rise 16px, spring ease.
        this._panel.remove_all_transitions();
        this._panel.set_scale(0.92, 0.92);
        this._panel.translation_y = px(16);
        this._panel.opacity = 0;
        this._panel.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            translation_y: 0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
        });
    }

    /**
     * Keyboard input goes to the search field and a press outside the
     * popover closes it. A modal grab is used when the shell grants one; the
     * outside-press handling works either way.
     */
    _grabInput() {
        try {
            this._modal = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        } catch (e) {
            console.error(`material3: app menu could not grab input: ${e.message}`);
            this._modal = null;
        }
        this._entry.grab_key_focus();
        this._startCaret();

        // The modal grab can keep the Super key away from the menu's own key
        // handler, so it is also watched at the stage (before any grab
        // filtering) and as the shell's overlay key. Whichever comes first
        // closes the menu; the others are then no-ops.
        this._stageSuperId = global.stage.connect('captured-event', (_stage, event) => {
            const type = event.type();
            if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE)
                return Clutter.EVENT_PROPAGATE;
            const key = event.get_key_symbol();
            if (key !== Clutter.KEY_Super_L && key !== Clutter.KEY_Super_R)
                return Clutter.EVENT_PROPAGATE;
            this._closeForSuper('stage key');
            return Clutter.EVENT_STOP;
        });
        try {
            this._overlaySuperId = global.display.connect('overlay-key', () => this._closeForSuper('overlay key'));
        } catch (e) {
            console.error(`material3: app menu could not watch the overlay key: ${e.message}`);
            this._overlaySuperId = 0;
        }

        // Last resort, and the one that does not depend on event routing: a
        // Super that goes from up to down while the menu is open closes it.
        this._superDown = this._superHeld();
        this._superPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SUPER_POLL_MS, () => {
            const down = this._superHeld();
            const pressed = down && !this._superDown;
            this._superDown = down;
            if (!pressed)
                return GLib.SOURCE_CONTINUE;
            this._superPollId = 0;
            this._closeForSuper('poll');
            return GLib.SOURCE_REMOVE;
        });

        this._stopWatching = watchOutsidePress({
            inside: this.actor,
            host: this.actor,
            onOutside: () => this.close(),
        });
    }

    _releaseInput() {
        this._stopCaret();
        if (this._superPollId) {
            GLib.source_remove(this._superPollId);
            this._superPollId = 0;
        }
        if (this._stageSuperId) {
            global.stage.disconnect(this._stageSuperId);
            this._stageSuperId = 0;
        }
        if (this._overlaySuperId) {
            global.display.disconnect(this._overlaySuperId);
            this._overlaySuperId = 0;
        }
        this._stopWatching?.();
        this._stopWatching = null;
        if (this._modal) {
            try {
                Main.popModal(this._modal);
            } catch (e) {
                console.error(`material3: app menu could not release input: ${e.message}`);
            }
            this._modal = null;
        }
    }

    close(animate = true) {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this._ctx.close(false);
        this._releaseInput();
        this._host.openChanged(false);
        this._cancelFill();

        this._panel.remove_all_transitions();
        if (!animate) {
            this.actor.hide();
            return;
        }
        this._panel.ease({
            opacity: 0,
            scale_x: 0.92,
            scale_y: 0.92,
            translation_y: px(16),
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this.isOpen)
                    this.actor.hide();
            },
        });
    }

    destroy() {
        this.isOpen = false;
        if (this._superWatchId)
            GLib.source_remove(this._superWatchId);
        this._superWatchId = 0;
        this._cancelFill();
        this._powerUnsub?.();
        this._powerUnsub = null;
        if (this._installedId)
            Shell.AppSystem.get_default().disconnect(this._installedId);
        this._installedId = 0;
        this._releaseInput();
        this.actor.destroy();
    }
}
