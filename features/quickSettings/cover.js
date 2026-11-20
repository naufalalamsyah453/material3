import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_async', 'new_from_stream_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const MAX_CACHED = 40;
const DOWNLOAD_TIMEOUT = 10; // seconds

let session = null;

function cacheDir() {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'material3', 'covers']);
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

/** Keep the cache small: drop the oldest files beyond MAX_CACHED. */
function prune(dir) {
    try {
        const enumerator = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const files = [];
        for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
            files.push({name: info.get_name(), time: info.get_modification_date_time()?.to_unix() ?? 0});
        files.sort((a, b) => b.time - a.time);
        for (const {name} of files.slice(MAX_CACHED))
            Gio.File.new_for_path(GLib.build_filenamev([dir, name])).delete(null);
    } catch (e) {
        console.error(`material3: cover cache cleanup failed: ${e.message}`);
    }
}

/** A local file for the cover URL: file:// as is, http(s):// downloaded once. */
async function localFile(url, dir, cancellable) {
    if (url.startsWith('file://'))
        return Gio.File.new_for_uri(url);

    if (!/^https?:\/\//.test(url))
        throw new Error(`unsupported cover URL scheme: ${url.split(':')[0]}`);

    const raw = GLib.build_filenamev([
        dir, `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)}.src`]);
    const file = Gio.File.new_for_path(raw);
    if (file.query_exists(null))
        return file;

    session ??= new Soup.Session({timeout: DOWNLOAD_TIMEOUT, user_agent: 'material3-gnome-shell-extension'});
    const message = Soup.Message.new('GET', url);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (message.status_code !== Soup.Status.OK)
        throw new Error(`cover download failed: HTTP ${message.status_code}`);

    GLib.file_set_contents(raw, bytes.get_data());
    return file;
}

/**
 * The cover as a centered square PNG of `size` pixels, ready to use as a CSS
 * background (YouTube thumbnails are 16:9: the middle square is kept).
 *
 * @param {string} url value of the MPRIS `mpris:artUrl` metadata
 * @param {number} size edge in pixels of the result
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<string>} path of the square PNG
 */
export async function loadCover(url, size, cancellable) {
    const dir = cacheDir();
    const source = await localFile(url, dir, cancellable);

    // Tied to the content as well, so a reused file name never serves a stale cover.
    const info = source.query_info('time::modified,standard::size', Gio.FileQueryInfoFlags.NONE, null);
    const stamp = `${url}|${info.get_attribute_uint64('time::modified')}|${info.get_size()}|${size}`;
    const out = GLib.build_filenamev([
        dir, `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, stamp, -1)}.png`]);
    if (GLib.file_test(out, GLib.FileTest.EXISTS))
        return out;

    const stream = await source.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable);

    const edge = Math.min(pixbuf.get_width(), pixbuf.get_height());
    const square = pixbuf.new_subpixbuf(
        Math.floor((pixbuf.get_width() - edge) / 2),
        Math.floor((pixbuf.get_height() - edge) / 2),
        edge, edge);
    const scaled = square.scale_simple(size, size, GdkPixbuf.InterpType.HYPER);
    scaled.savev(out, 'png', [], []);

    prune(dir);
    return out;
}
