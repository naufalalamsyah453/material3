// Translation entry point for the shell side of the extension.
//
// The stock `gettext` export of extension.js finds the extension by walking
// the call stack and throws ("gettext can only be called from extensions")
// when it cannot. The extension object is handed over explicitly instead.

let translate = s => s;

/** @param {(s: string) => string} fn the extension's own `gettext` */
export function setTranslator(fn) {
    translate = fn ?? (s => s);
}

/** @param {string} s */
export function _(s) {
    return translate(s);
}
