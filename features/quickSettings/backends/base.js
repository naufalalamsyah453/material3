/** Tracks signal connections so they can all be dropped at once. */
export class SignalBag {
    constructor() {
        this._items = [];
    }

    connect(object, name, callback) {
        const id = object.connect(name, callback);
        this._items.push([object, id]);
        return id;
    }

    clear() {
        for (const [object, id] of this._items) {
            try {
                object.disconnect(id);
            } catch {
                // The object may already be gone.
            }
        }
        this._items = [];
    }
}

/**
 * Common base for system backends. Subclasses call _emit() whenever their
 * state changes; the UI subscribes and re-reads the getters.
 */
export class Backend {
    constructor() {
        this._listeners = new Set();
        this._signals = new SignalBag();
        this._destroyed = false;
    }

    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _emit() {
        if (this._destroyed)
            return;
        for (const callback of [...this._listeners])
            callback();
    }

    destroy() {
        this._destroyed = true;
        this._signals.clear();
        this._listeners.clear();
        this._onDestroy();
    }

    _onDestroy() {}
}
