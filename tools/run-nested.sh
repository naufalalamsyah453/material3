#!/usr/bin/env bash
# Run the Material 3 extension in an isolated, headless GNOME Shell and take
# light/dark screenshots of the Quick Settings menu.
#
# Usage: tools/run-nested.sh [light|dark|both] [outdir]
set -uo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-both}"
OUTDIR="${2:-/tmp/opencode/m3-shots}"
BASE="/tmp/opencode/m3-nested"
SHOT_TIMEOUT=30

mkdir -p "$OUTDIR"

log_tail() {
    sed -n '1,200p' "$1" 2>/dev/null | grep -vE '^\s*$' | tail -n 20
}

run_mode() {
    local mode="$1"
    local root="${BASE}-${mode}"
    local home="${root}/home"
    local log="${root}/shell.log"

    rm -rf "$root"
    mkdir -p "${home}/.local/share/gnome-shell/extensions" \
        "${home}/.config" "${home}/run"
    chmod 700 "${home}/run"

    ln -s "${PROJECT}" \
        "${home}/.local/share/gnome-shell/extensions/material3@local"
    cp -r "${PROJECT}/tools/probe" \
        "${home}/.local/share/gnome-shell/extensions/m3probe@local"
    ln -s "${HOME}/.local/share/fonts" "${home}/.local/share/fonts"

    export HOME="$home"
    export XDG_CONFIG_HOME="${home}/.config"
    export XDG_DATA_HOME="${home}/.local/share"
    export XDG_RUNTIME_DIR="${home}/run"
    export M3_MODE="$mode"
    export M3_ROOT="$root"
    export M3_LOG="$log"
    export M3_OUT="$OUTDIR"
    export M3_SHOT_TIMEOUT="$SHOT_TIMEOUT"

    fc-cache -f >/dev/null 2>&1

    dbus-run-session -- bash -s <<'INNER'
set -uo pipefail
mode="$M3_MODE"
root="$M3_ROOT"
log="$M3_LOG"
out="$M3_OUT"
timeout="$M3_SHOT_TIMEOUT"
display="wl-m3-${mode}"

gsettings set org.gnome.shell enabled-extensions \
    "['material3@local', 'm3probe@local']" 2>/dev/null
gsettings set org.gnome.shell disable-user-extensions false 2>/dev/null
gsettings set org.gnome.shell welcome-dialog-last-shown-version '51.1' 2>/dev/null
gsettings set org.gnome.desktop.interface color-scheme \
    "$([ "$mode" = dark ] && echo prefer-dark || echo default)" 2>/dev/null

gnome-shell --headless --wayland-display="$display" --no-x11 \
    --virtual-monitor 1600x1000 >"$log" 2>&1 &
shell_pid=$!

for _ in $(seq 1 60); do
    [ -S "${XDG_RUNTIME_DIR}/${display}" ] && break
    sleep 0.5
done

for _ in $(seq 1 $((timeout * 2))); do
    grep -q 'M3PROBE' "$log" 2>/dev/null && break
    sleep 0.5
done
sleep 1

python3 "${M3_PROJECT}/tools/shot.py" "${out}/qs-${mode}.png" 2>&1 | tail -1

read -r px py pw ph < <(
    grep -o 'M3PROBE -\?[0-9]\+ -\?[0-9]\+ [0-9]\+ [0-9]\+' "$log" |
    tail -1 | cut -d' ' -f2-
)

if [ -n "${pw:-}" ]; then
    magick "${out}/qs-${mode}.png" -crop \
        "${pw}x${ph}+${px}+${py}" +repage "${out}/panel-${mode}.png"
    echo "panel ${pw}x${ph}+${px}+${py}"
else
    echo "no M3PROBE geometry found"
fi

kill "$shell_pid" 2>/dev/null
wait 2>/dev/null

echo "--- shell.log (filtered) ---"
grep -inE 'error|critical|warning|not allowed|failed' "$log" |
    grep -viE 'portal|systemd|pipewire|at-spi|atk|realtimekit|evolution|geolocation|camera|authenticationagent|libmutter|brightness|keybinding|dconf|Failed to load module|cantarell' |
    head -n 25
INNER

    echo "== ${mode} =="
    log_tail "$log"
}

export M3_PROJECT="$PROJECT"

case "$MODE" in
    light|dark) run_mode "$MODE" ;;
    both)
        run_mode light
        run_mode dark
        ;;
    *)
        echo "usage: $0 [light|dark|both] [outdir]" >&2
        exit 2
        ;;
esac
