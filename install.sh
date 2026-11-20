#!/usr/bin/env bash
# Install (or refresh) the Material 3 extension for the current user.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
TARGET="${EXTENSIONS}/material3@local"
FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts/MaterialSymbolsFilled"

mkdir -p "$EXTENSIONS"

if [ -L "$TARGET" ]; then
    rm "$TARGET"
elif [ -e "$TARGET" ]; then
    mv "$TARGET" "${TARGET}.bak.$(date +%s)"
fi
ln -s "$PROJECT" "$TARGET"

if [ -f "${PROJECT}/assets/fonts/MaterialSymbolsFilled.ttf" ]; then
    mkdir -p "$FONT_DIR"
    cp "${PROJECT}/assets/fonts/MaterialSymbolsFilled.ttf" "$FONT_DIR/"
    fc-cache -f >/dev/null 2>&1 || true
fi

# Compile the extension's GSettings schema (needed for prefs and the header name).
if [ -d "${PROJECT}/schemas" ]; then
    glib-compile-schemas "${PROJECT}/schemas"
fi

# Enable the extension. gnome-extensions can only enable extensions the
# running shell already knows about, so fall back to the gsettings list.
if ! gnome-extensions enable material3@local 2>/dev/null; then
    current="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || true)"
    if [ -z "$current" ] || [ "$current" = "@as []" ] || [ "$current" = "[]" ]; then
        gsettings set org.gnome.shell enabled-extensions "['material3@local']"
    elif ! printf '%s' "$current" | grep -q 'material3@local'; then
        gsettings set org.gnome.shell enabled-extensions \
            "${current%]}, 'material3@local']"
    fi
fi

printf 'Extension: %s\n' "$TARGET"
printf 'Font:      %s\n' "$FONT_DIR/MaterialSymbolsFilled.ttf"
printf 'Settings:  gnome-extensions prefs material3@local\n'
printf '\nReload the shell to pick up the extension:\n'
printf '  X11:     Alt+F2, type "r", Enter\n'
printf '  Wayland: log out and back in\n'
