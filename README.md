# Material 3 for GNOME Shell

A Material 3 (Android 17 / Material You) component suite for GNOME Shell 51.
The suite is modular; Quick Settings is the first completed feature.

## Quick Settings

A 1:1 static replica of the lavender Android 17 Quick Settings panel:

- 360 px panel, 32 px radius, Material tonal surface + outline, light/dark
- User header (avatar, name, subtitle, settings, close)
- Grouped brightness/volume capsule sliders: −/+ step buttons, primary fill,
  thumb bar, percentage badge
- 2 × 3 expressive quick toggles (Wi-Fi, Bluetooth, Dark Style, Do Not Disturb,
  Night Light, Power Mode), active state with 18 px radius
- Media card with cover, title, subtitle and transport controls

Light/dark follows `org.gnome.desktop.interface color-scheme` and is applied
live; no shell restart is needed for the mode switch.

### Interactions (1:1 with the reference HTML)

- **Sliders**: press and drag anywhere on the capsule, scroll, or use
  Left/Right/Up/Down/Home/End/PageUp/PageDown. -/+ step by 10. Held state:
  radius 16 -> 22 (spring), thumb bar 4x22 -> 3x28, icon scale 1.15 and
  rotate -8deg (bounce). Icon and value badge follow the value.
- **Tiles**: radius 28 <-> 18 (bounce), fill and text colors fade, icon scale
  1.12 when active, pop 0.93 -> 1.03 -> 1, press scale 0.94.
- **Buttons / media controls**: press scale 0.95 (bounce); -/+ buttons 0.9.
- The reference `--spring-ease` / `--bounce-ease` cubic-beziers are evaluated
  in `animation.js` (St itself cannot overshoot or interpolate radius).

### Live system state

| Control        | Source                                                        |
| -------------- | ------------------------------------------------------------- |
| Brightness     | `Main.brightnessManager.globalScale` (overlay if no backlight) |
| Volume         | shared `Gvc.MixerControl` default sink                         |
| Wi-Fi          | NetworkManager `WirelessEnabled`, active SSID                  |
| Bluetooth      | GnomeBluetooth + rfkill airplane mode                          |
| Dark Style     | `org.gnome.desktop.interface color-scheme`                     |
| Do Not Disturb | `org.gnome.desktop.notifications show-banners` (inverted)      |
| Night Light    | `org.gnome.settings-daemon.plugins.color night-light-enabled`  |
| Power Mode     | `org.freedesktop.UPower.PowerProfiles` + battery percentage    |
| Media          | shell `MprisSource` (play/pause/next/previous)                 |

A backend that cannot start is replaced by an inert one: its tile is dimmed
and disabled instead of breaking the panel.

## Dock dan app menu

Dock melayang di bawah layar dan app menu (App Drawer) yang dibukanya, 1:1 dengan
`android_17_material_you_desktop_os.html`:

- **Dock**: pill 64 px, radius 28. Tombol menu aplikasi, ikon aplikasi favorit +
  aplikasi yang sedang berjalan, dan pil pengganti palet (menampilkan nama palet).
  Indikator di bawah ikon: tidak ada (tertutup), titik 6 px (diminimalkan), garis
  16 px (terbuka). Klik: buka jika tertutup/diminimalkan, minimalkan jika sedang
  fokus; klik tengah membuka jendela baru. Animasi minimize terbang ke ikon dock,
  lalu ikon memantul (`dockAbsorbBounce`).
- **App menu**: popover 480 px di atas dock (radius 32) dengan header "Semua
  Aplikasi" + tombol Tema dan mode terang/gelap, kolom pencarian (Enter membuka hasil
  pertama), pil kategori (Semua / Produktivitas / Sistem / Utilitas dari kategori
  desktop entry), grid 4 kolom dengan animasi muncul bertahap, dan kartu
  "Lanjutkan Terakhir" (jendela yang terakhir dipakai). Klik di luar atau `Esc`
  menutupnya.
- Mengikuti palet (aksen GNOME), mode terang/gelap, skala UI dan font yang sama
  dengan Quick Settings. Dock disembunyikan di Overview dan layar penuh. Overview saat login dilewati, dan dash bawaan Overview disembunyikan.
- Nonaktifkan di pengaturan extension -> "Dock and app menu" -> "Show dock"
  (`show-dock`).

```
features/dock/
  index.js     pemasangan, posisi, sinyal shell, tema/mode/skala
  dock.js      pill dock, item aplikasi, indikator, bounce, ikon minimize
  appMenu.js   popover app menu (header, pencarian, kategori, grid, saran)
  apps.js      daftar aplikasi terpasang dan pemetaan kategori
```

### Menu konteks, ukuran app menu, dan power mode

- **Menu konteks** (klik kanan ikon dock atau kartu aplikasi) menutup sendiri saat
  klik di luarnya. Klik itu hanya menutup menu dan tidak diteruskan ke yang ada di
  bawahnya. Font-nya punya pengaturan sendiri: Pengaturan -> "Context menu font"
  (`context-font-family`; kosong = sama dengan font utama).
- **App menu**: lebar (`appmenu-width`, 360-900 px; kartu aplikasi membagi lebarnya
  sama rata) dan tinggi grid (`appmenu-height`) punya pengaturan terpisah di
  "Dock and app menu".
- **Power mode**: tombol di header app menu, di samping tombol Tema. Mengkliknya
  membuka pop-up Performance / Balanced / Power Saver (profil aktif diberi tanda
  centang, ikon tombol mengikuti profil). Tombol tersembunyi jika
  power-profiles-daemon tidak tersedia.

## Pengaturan (pengganti GNOME Settings)

Aplikasi GTK 4 asli (`app/`, dijalankan `gjs -m app/main.js`), jadi tiling, snap, resize,
drag, dan scrollbar ditangani compositor. Tampilan mengikuti HTML (sidebar pil, kartu,
switch M3, slider ekspresif). 20 halaman: Wi-Fi & Jaringan, Bluetooth, Tampilan,
Notifikasi, Pencarian, Multitasking, Aplikasi, Privasi, Berbagi, Layar, Suara, Daya,
Mouse & Touchpad, Keyboard, Pengaturan Lainnya, Tanggal & Waktu, Wilayah & Bahasa,
Aksesibilitas, Penyimpanan, Tentang. Nilai dibaca/ditulis lewat GSettings (sama dengan
perintah `gsettings`), plus nmcli, bluetoothctl, wpctl, timedatectl.

- Extension membuat `~/.local/share/applications/org.gnome.Settings.desktop` (override),
  menyembunyikan entri panel GNOME Settings, dan menonaktifkan search provider-nya.
  Semua dihapus saat "Replace GNOME Settings" (`show-settings`) dimatikan.
- Panel yang tidak ditiru (printer, akun online, pengguna, dll.) dibuka lewat halaman
  "Pengaturan Lainnya" memakai `gnome-control-center`.
- Kecepatan animasi (`anim-scale`) tetap diatur extension (`St.Settings.slow_down_factor`).

## Themes and options

- The palette button in the header cycles Lavender, Sage Green, Ocean Blue
  and Terracotta (the HTML palettes, light and dark). The choice is stored in
  GSettings (`theme`) and is also available in the preferences. Non-default
  themes are generated from `stylesheet.css` (see `themes.js`) into
  `~/.cache/material3/` and layered over the base stylesheet.
- Right-click Wi-Fi, Bluetooth or Power Mode to open a pane over the tile
  grid: networks in range (click to connect/disconnect), paired Bluetooth
  devices (click to connect/disconnect), or the available power modes.
  Back button, Escape, or closing the menu dismisses it.

## Settings

`gnome-extensions prefs material3@local` (or the Extensions app) opens the
preferences. The header name can follow the account full name (default),
login name, computer host name, or a custom text; it updates live. The avatar
initial follows the name.

## Install

```sh
./install.sh
```

On Wayland, log out and back in; on X11, `Alt+F2` → `r`.

The filled Material Symbols instance (`assets/fonts/MaterialSymbolsFilled.ttf`)
is installed into `~/.local/share/fonts`. The outlined icons use the
`Material Symbols Rounded` font (already required from the original design).

## Test

`tools/run-nested.sh` starts an isolated headless GNOME Shell with a private
D-Bus session and HOME, opens Quick Settings through a probe extension, and
writes light and dark screenshots:

```sh
./tools/run-nested.sh both /tmp/opencode/m3-shots
# -> /tmp/opencode/m3-shots/panel-light.png
#    /tmp/opencode/m3-shots/panel-dark.png
```

The reference HTML can be rendered with Firefox headless and cropped with the
same 360 px geometry; the panel box measured 360 × 516 in both modes.

## Layout

```
extension.js                     extension entry point
prefs.js                         preferences (header name source)
schemas/                         GSettings schema (+ compiled)
features/quickSettings/
  panel.js                       menu injection, header, lifecycle, theme
  slider.js                      grouped capsule sliders
  tiles.js                       2 × 3 quick toggles
  media.js                       media card
  widgets.js                     symbols, labels, icon buttons
  detail.js                      right-click options pane over the tile grid
  themes.js                      palettes + stylesheet recoloring
  animation.js                   spring/bounce easing + tween driver
  palette.js                     tile text colors tweened in JS
  backends/                      brightness, volume, network, bluetooth,
                                 settings, power, mpris
stylesheet.css                   Material tokens + component CSS
tools/run-nested.sh              isolated headless screenshot harness
tools/shot.py                    screenshot helper (private session bus)
tools/probe/                     test extension that opens the menu
assets/fonts/                    FILL=1 Material Symbols instance
```

The stock `QuickSettingsMenu` is preserved: the Material surface is injected
into its grid, stock items are hidden, and the grid is switched to a single
column. This keeps panel integration, focus and popup behaviour intact.

## Status

Syntax-checked and the easing/tween math unit-tested outside the shell. It has
not been run inside a live GNOME Shell session; use `tools/run-nested.sh` or
log in again after `./install.sh` and check `journalctl -f -o cat /usr/bin/gnome-shell`.

## Skala UI, font, dan OSD

- **OSD brightness**: menggeser slider brightness (atau tombol -/+) di Quick Settings menampilkan OSD shell, seperti volume.
- **Pengaturan extension → "Size and font"**: `UI scale` (0.75–1.5) menskalakan seluruh panel (tile, slider, ikon, jarak), `Text size` (0.8–1.4) menambah skala teks, dan `Font` memilih font keluarga teks (tombol hapus mengembalikan default). Perubahan langsung berlaku.
- Setelah memperbarui schema jalankan `glib-compile-schemas schemas` (sudah dilakukan oleh `install.sh`).


## Kategori app menu

Di **Pengaturan ekstensi → App menu**:

- **Kategori favorit**: bila aktif, app menu terbuka di kategori favorit dan hanya
  membaca aplikasi kategori itu. Kategori lain dibaca saat pertama kali dipilih,
  sehingga pembukaan pertama app menu lebih ringan.
- **Posisi kategori**: ubah urutan pil dengan tombol panah, atau sembunyikan kategori
  bawaan yang tidak dipakai.
- **Kategori kustom**: tambah, ganti nama, hapus, dan pilih aplikasi di dalamnya.
  Aplikasi di kategori kustom tetap muncul di kategori bawaannya.

Perubahan berlaku saat app menu dibuka berikutnya, tanpa me-reload shell.

## Perubahan app menu dan OSD

- Pil kategori selalu mengisi lebar bar, berapa pun jumlahnya.
- Mengetik di kolom pencarian menyembunyikan pil kategori dan mencari di semua aplikasi.
- Header app menu menampilkan nama pengguna komputer (sesuai pengaturan nama Quick Settings).
- OSD volume, kecerahan, dan mikrofon bergaya Material 3 (bisa dimatikan di pengaturan, grup
  "On-screen display").
