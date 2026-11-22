import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Small on-disk cache (~/.cache/material3) for the slow parts of the
 * Settings app: directory scans and decoded thumbnails. Entries are reused
 * across launches until they are older than their time to live.
 */
const DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'material3']);
const FILE = GLib.build_filenamev([DIR, 'settings.json']);
const THUMBS = GLib.build_filenamev([DIR, 'thumbs']);

let data = null;

function load() {
    if (data)
        return data;
    try {
        const [ok, bytes] = GLib.file_get_contents(FILE);
        data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch {
        data = {};
    }
    return data;
}

/** @returns {*} the cached value, or undefined when missing or older than `ttlMs` */
export function cacheGet(key, ttlMs) {
    const entry = load()[key];
    if (!entry || Date.now() - entry.t > ttlMs)
        return undefined;
    return entry.v;
}

export function cacheSet(key, value) {
    load()[key] = {t: Date.now(), v: value};
    try {
        GLib.mkdir_with_parents(DIR, 0o755);
        GLib.file_set_contents(FILE, JSON.stringify(data));
    } catch {
        // The cache is only an optimisation.
    }
}

const thumbPath = (uri, w, h) =>
    GLib.build_filenamev([THUMBS, `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, `${uri}@${w}x${h}`, -1)}.png`]);

/** A cached thumbnail texture, or null (also when the source image changed after it was cached). */
export function thumbGet(uri, w, h) {
    const path = thumbPath(uri, w, h);
    try {
        if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            return null;
        // Stale when the image was modified after the thumbnail was written.
        const source = Gio.File.new_for_uri(uri).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const cached = Gio.File.new_for_path(path).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        if (source.get_attribute_uint64('time::modified') > cached.get_attribute_uint64('time::modified'))
            return null;
        return Gdk.Texture.new_from_filename(path);
    } catch {
        return null;
    }
}

export function thumbPut(uri, w, h, pixbuf) {
    try {
        GLib.mkdir_with_parents(THUMBS, 0o755);
        pixbuf.savev(thumbPath(uri, w, h), 'png', [], []);
    } catch {
        // Not cached this time.
    }
}
