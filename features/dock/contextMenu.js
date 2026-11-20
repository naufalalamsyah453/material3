import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_} from '../../i18n.js';
import {activateApp} from '../settings/launcher.js';

import {px, scoped} from '../quickSettings/ui.js';
import {pressFeedback, symbolIcon, textLabel} from '../quickSettings/widgets.js';

/** The actor an input event was aimed at. */
export function eventTarget(event) {
    return global.stage.get_event_actor?.(event) ?? event.get_source?.() ?? null;
}

/**
 * Call `onOutside` when a press lands outside `inside`.
 *
 * Under a modal grab the events outside are redirected to the grab actor, so
 * a click gesture on `host` (the grab actor) sees them, like the shell's own
 * popup menus. A capture handler on the stage covers the no-grab case, and
 * swallows the press so it does not click whatever is underneath.
 *
 * @param {object} params
 * @param {Clutter.Actor} params.inside area that counts as "inside"
 * @param {Clutter.Actor} [params.host] grab actor carrying the click gesture
 * @param {function(): void} params.onOutside
 * @returns {function(): void} stop watching
 */
export function watchOutsidePress({inside, host = null, onOutside}) {
    const isInside = event => {
        const target = eventTarget(event);
        return !!target && inside.contains(target);
    };

    let gesture = null;
    if (host && Clutter.ClickGesture) {
        try {
            gesture = new Clutter.ClickGesture({recognize_on_press: true});
            gesture.connect('may-recognize', () =>
                !isInside(gesture.get_point_event(0)));
            gesture.connect('recognize', () => onOutside());
            host.add_action(gesture);
        } catch (e) {
            console.error(`material3: click gesture unavailable: ${e.message}`);
            gesture = null;
        }
    }

    const capturedId = global.stage.connect('captured-event', (_stage, event) => {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        if (isInside(event))
            return Clutter.EVENT_PROPAGATE;

        onOutside();
        return Clutter.EVENT_STOP;
    });

    return () => {
        global.stage.disconnect(capturedId);
        if (gesture) {
            try {
                host.remove_action(gesture);
            } catch {
                // The host may already be gone.
            }
        }
    };
}

/**
 * Run `callback` when the pointer is pressed on `actor`: a click gesture
 * where the toolkit has one, and the plain button-press signal as well
 * (closing twice is harmless).
 *
 * @param {Clutter.Actor} actor
 * @param {function(): void} callback
 */
function onPress(actor, callback) {
    if (Clutter.ClickGesture) {
        try {
            const gesture = new Clutter.ClickGesture({recognize_on_press: true});
            gesture.connect('recognize', () => callback());
            actor.add_action(gesture);
        } catch (e) {
            console.error(`material3: scrim gesture unavailable: ${e.message}`);
        }
    }
    try {
        actor.connect('button-press-event', () => {
            callback();
            return Clutter.EVENT_STOP;
        });
    } catch {
        // The legacy signal is gone in this shell; the gesture covers it.
    }
}

/**
 * Menu entries for an application: open, new window, its desktop actions,
 * pin/unpin and quit.
 *
 * @param {Shell.App} app
 * @param {function(): void} done called after an entry ran (to close menus)
 * @returns {Array<object>}
 */
export function appContextItems(app, done) {
    const run = callback => () => {
        done();
        try {
            callback();
        } catch (e) {
            console.error(`material3: context action failed: ${e.message}`);
        }
    };

    const items = [];
    const running = app.get_windows().length > 0;

    items.push({
        icon: 'open_in_new',
        label: running ? _('Show') : _('Open'),
        activate: run(() => activateApp(app)),
    });

    if (app.can_open_new_window() && running) {
        items.push({
            icon: 'add',
            label: _('New Window'),
            activate: run(() => app.open_new_window(-1)),
        });
    }

    const info = app.get_app_info?.();
    const actions = info?.list_actions?.() ?? [];
    if (actions.length > 0) {
        items.push({separator: true});
        for (const action of actions) {
            items.push({
                icon: 'bolt',
                label: info.get_action_name(action),
                activate: run(() => app.launch_action(action, global.get_current_time(), -1)),
            });
        }
    }

    items.push({separator: true});

    const favorites = AppFavorites.getAppFavorites();
    const id = app.get_id();
    if (favorites.isFavorite(id)) {
        items.push({
            icon: 'keep_off',
            label: _('Unpin from Dock'),
            activate: run(() => favorites.removeFavorite(id)),
        });
    } else {
        items.push({
            icon: 'keep',
            label: _('Pin to Dock'),
            activate: run(() => favorites.addFavorite(id)),
        });
    }

    if (running) {
        items.push({
            icon: 'close',
            label: _('Close All Windows'),
            destructive: true,
            activate: run(() => app.request_quit()),
        });
    }

    return items;
}

/**
 * Small Material popup with a list of actions. It lives either in the chrome
 * (the dock) or inside another surface (the app menu, which holds a modal
 * grab, so the menu has to be part of it to receive input).
 */
export class ContextMenu {
    /**
     * @param {object} [params]
     * @param {Clutter.Actor} [params.container] fixed-layout actor that
     *   hosts the menu (when it is not chrome of its own)
     * @param {Clutter.Actor} [params.grabHost] modal grab actor, if any
     * @param {function(boolean): void} [params.onOpenChanged]
     */
    constructor({container = null, grabHost = null, onOpenChanged = null} = {}) {
        this._onOpenChanged = onOpenChanged;
        this.isOpen = false;
        this._container = container;
        this._grabHost = grabHost;
        this._stopWatching = null;
        this._scrim = null;

        // The wrapper carries `m3-qs` (+ light/dark, set by the feature) so
        // the palette rules apply to the list inside it.
        this.actor = new St.Widget({
            style_class: 'm3-qs',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            reactive: true,
        });
        this._list = new St.BoxLayout({
            style_class: 'm3-ctx',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this.actor.add_child(this._list);
        this.actor.set_pivot_point(0.5, 1);
        if (container)
            container.add_child(this.actor);
    }

    /**
     * Invisible full-surface catcher under the menu: a press anywhere
     * outside the menu lands on it, closes the menu and goes no further (so
     * it does not click whatever is underneath). It sits in the container
     * for a menu that lives inside another surface, and in the chrome
     * (covering the whole stage) for the dock's menu.
     */
    _showScrim() {
        if (!this._scrim) {
            this._scrim = new St.Widget({reactive: true, visible: false});
            onPress(this._scrim, () => this.close());
            if (this._container) {
                this._container.add_child(this._scrim);
            } else {
                try {
                    Main.layoutManager.addChrome(this._scrim);
                } catch (e) {
                    console.error(`material3: context scrim failed: ${e.message}`);
                }
            }
        }

        if (this._container) {
            this._scrim.set_position(0, 0);
            this._scrim.set_size(this._container.width, this._container.height);
            this._container.set_child_below_sibling(this._scrim, this.actor);
        } else {
            this._scrim.set_position(0, 0);
            this._scrim.set_size(global.stage.width, global.stage.height);
            Main.layoutManager.uiGroup.set_child_above_sibling(this._scrim, null);
            Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        }
        this._scrim.show();
    }

    /**
     * @param {Array<object>} items {label, icon, activate, destructive, selected} or {separator: true}
     * @param {object} anchor
     * @param {number} anchor.x stage x
     * @param {number} anchor.y stage y
     * @param {string} [anchor.placement] 'above' (centered over x,y),
     *   'pointer' (top-left corner at x,y, flipped when it would not fit) or
     *   'below-end' (top-right corner at x,y, e.g. under a button)
     */
    open(items, {x, y, placement = 'above'}) {
        this.close(false);

        scoped('menu', () => {
            this._list.destroy_all_children();
            for (const item of items) {
                this._list.add_child(item.separator
                    ? new St.Widget({style_class: 'm3-ctx-separator', height: px(1)})
                    : this._row(item));
            }
        });

        this.actor.show();
        if (!this._container)
            Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this._showScrim();

        const [, width] = this.actor.get_preferred_width(-1);
        const [, height] = this.actor.get_preferred_height(width);

        let left;
        let top;
        let bounds;
        if (this._container) {
            const [, lx, ly] = this._container.transform_stage_point(x, y);
            left = lx;
            top = ly;
            bounds = {x: 0, y: 0, width: this._container.width, height: this._container.height};
        } else {
            left = x;
            top = y;
            const monitor = Main.layoutManager.primaryMonitor;
            bounds = {x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height};
        }

        const edge = px(8);
        if (placement === 'above') {
            left -= width / 2;
            top -= height;
        } else if (placement === 'below-end') {
            left -= width;
            if (top + height > bounds.y + bounds.height - edge)
                top -= height + px(40);
        } else {
            if (left + width > bounds.x + bounds.width - edge)
                left -= width;
            if (top + height > bounds.y + bounds.height - edge)
                top -= height;
        }
        left = Math.max(bounds.x + edge, Math.min(left, bounds.x + bounds.width - width - edge));
        top = Math.max(bounds.y + edge, Math.min(top, bounds.y + bounds.height - height - edge));

        this.actor.set_position(Math.round(left), Math.round(top));
        this.isOpen = true;
        this._onOpenChanged?.(true);

        this._stopWatching = watchOutsidePress({
            inside: this.actor,
            host: this._grabHost,
            onOutside: () => this.close(),
        });

        this.actor.remove_all_transitions();
        this.actor.opacity = 0;
        this.actor.translation_y = px(6);
        this.actor.ease({
            opacity: 255,
            translation_y: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    close(animate = true) {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this._stopWatching?.();
        this._stopWatching = null;
        this._scrim?.hide();
        this._onOpenChanged?.(false);

        this.actor.remove_all_transitions();
        if (!animate) {
            this.actor.hide();
            return;
        }
        this.actor.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this.isOpen)
                    this.actor.hide();
            },
        });
    }

    _row({label, icon, activate, destructive, selected}) {
        const button = new St.Button({
            style_class: `m3-ctx-item${destructive ? ' m3-ctx-danger' : ''}${selected ? ' m3-ctx-selected' : ''}`,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        // Left-aligned: the content fills the row and its icon and text start
        // at the left edge. The menu is as wide as its longest label.
        const content = new St.BoxLayout({
            style: `spacing: ${px(12)}px;`,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        content.add_child(symbolIcon(icon ?? 'chevron_right', {size: 18}));
        content.add_child(textLabel(label, 'm3-ctx-text', {x_expand: true}));
        if (selected)
            content.add_child(symbolIcon('check', {size: 18, styleClass: 'm3-ctx-check'}));
        button.set_child(content);
        pressFeedback(button, {scale: 0.97});
        button.connect('clicked', () => {
            this.close(false);
            activate();
        });
        return button;
    }

    destroy() {
        this.close(false);
        if (this._scrim) {
            if (!this._container) {
                try {
                    Main.layoutManager.removeChrome(this._scrim);
                } catch {
                    // Not tracked any more.
                }
            }
            this._scrim.destroy();
            this._scrim = null;
        }
        this.actor.destroy();
    }
}
