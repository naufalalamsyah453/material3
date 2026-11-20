import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Backend} from './base.js';

export const BRIGHTNESS_MIN = 0;
const OVERLAY_MAX_OPACITY = 0.55;

/**
 * Screen brightness through the shell's BrightnessManager global scale.
 * Without a controllable backlight it falls back to a black overlay, the
 * same way the reference page dims itself.
 */
export class BrightnessBackend extends Backend {
    constructor() {
        super();

        this._scale = null;
        this._scaleId = 0;
        this._softValue = 100;
        this._overlay = null;

        const manager = Main.brightnessManager;
        if (manager)
            this._signals.connect(manager, 'changed', () => this._bindScale());
        this._bindScale();
    }

    get value() {
        if (this._scale)
            return Math.max(BRIGHTNESS_MIN, Math.min(100, Math.round(this._scale.value * 100)));
        return this._softValue;
    }

    setValue(value) {
        const clamped = Math.max(BRIGHTNESS_MIN, Math.min(100, Math.round(value)));
        if (this._scale) {
            this._scale.value = clamped / 100;
        } else {
            this._softValue = clamped;
            this._ensureOverlay().opacity =
                Math.round(((100 - clamped) / 100) * OVERLAY_MAX_OPACITY * 255);
        }
        this._showOsd(clamped);
    }

    /**
     * Shell OSD, like the one volume shows. Only user-driven changes (this
     * method) raise it, never changes made elsewhere in the system.
     */
    _showOsd(value) {
        try {
            Main.osdWindowManager.showAll(
                new Gio.ThemedIcon({name: 'display-brightness-symbolic'}),
                null, value / 100, 1);
        } catch (e) {
            console.error(`material3: brightness OSD failed: ${e.message}`);
        }
    }

    _bindScale() {
        this._unbindScale();

        this._scale = Main.brightnessManager?.globalScale ?? null;
        if (this._scale) {
            this._scaleId = this._scale.connect('notify::value', () => this._emit());
            this._removeOverlay();
        }
        this._emit();
    }

    _unbindScale() {
        if (this._scale && this._scaleId) {
            try {
                this._scale.disconnect(this._scaleId);
            } catch {
                // Scale already destroyed by the manager.
            }
        }
        this._scale = null;
        this._scaleId = 0;
    }

    _ensureOverlay() {
        if (this._overlay)
            return this._overlay;

        this._overlay = new St.Widget({
            style: 'background-color: black;',
            reactive: false,
            opacity: 0,
        });
        this._overlay.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        Main.uiGroup.add_child(this._overlay);
        return this._overlay;
    }

    _removeOverlay() {
        this._overlay?.destroy();
        this._overlay = null;
    }

    _onDestroy() {
        this._unbindScale();
        this._removeOverlay();
    }
}
