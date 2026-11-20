#!/usr/bin/env python3
"""Take a screenshot inside an isolated GNOME Shell session.

GNOME Shell only lets the owner of org.gnome.SettingsDaemon.MediaKeys call
the screenshot D-Bus API, so this helper claims that name first (only safe in
a private session bus, which is exactly how run-nested.sh runs it).
"""
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
Gio.bus_own_name_on_connection(
    bus, "org.gnome.SettingsDaemon.MediaKeys", Gio.BusNameOwnerFlags.NONE,
    None, None)

loop = GLib.MainLoop()


def take_shot():
    path = sys.argv[1]
    try:
        res = bus.call_sync(
            "org.gnome.Shell.Screenshot",
            "/org/gnome/Shell/Screenshot",
            "org.gnome.Shell.Screenshot",
            "Screenshot",
            GLib.Variant("(bbs)", (False, False, path)),
            None, Gio.DBusCallFlags.NONE, -1, None)
        print(res.unpack(), flush=True)
    except Exception as error:  # noqa: BLE001
        print(f"ERR {error}", flush=True)
    finally:
        loop.quit()
    return False


GLib.timeout_add(700, take_shot)
loop.run()
