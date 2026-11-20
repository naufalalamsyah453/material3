import Gettext from 'gettext';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DOMAIN = 'material3';

/** Bind the extension's translations (`<extension>/locale`) for this process. */
export function initTranslations() {
    const here = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    Gettext.bindtextdomain(DOMAIN, GLib.build_filenamev([here.get_path(), 'locale']));
}

/** @param {string} s */
export function _(s) {
    return Gettext.dgettext(DOMAIN, s);
}

// gjs has no String.prototype.format outside the shell: provide %s, %d and %%.
if (typeof String.prototype.format !== 'function') {
    Object.defineProperty(String.prototype, 'format', {
        configurable: true,
        writable: true,
        value(...args) {
            let next = 0;
            return this.replace(/%(?:(\d+)\$)?([sd%])/g, (_m, position, kind) => {
                if (kind === '%')
                    return '%';
                const value = args[position ? Number(position) - 1 : next++];
                return kind === 'd' ? `${Math.trunc(Number(value))}` : `${value}`;
            });
        },
    });
}
