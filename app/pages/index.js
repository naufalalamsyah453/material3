import {_} from '../i18n.js';

/**
 * Every page of the app: the module (pages/<file>.js exports `build()`),
 * its sidebar icon and title, and search keywords (English and Indonesian).
 */
export const PAGES = {
    network: {
        file: 'network', icon: 'wifi', title: () => _('Wi-Fi & Network'),
        sub: () => _('Wi-Fi, VPN, proxy'), tone: 'sky',
        keywords: 'wifi wi-fi network internet jaringan ethernet vpn proxy hotspot airplane pesawat metered',
    },
    bluetooth: {
        file: 'bluetooth', icon: 'bluetooth', title: () => _('Bluetooth'),
        sub: () => _('Devices and pairing'), tone: 'sky',
        keywords: 'bluetooth headphones earbuds speaker perangkat nirkabel',
    },
    appearance: {
        file: 'appearance', icon: 'palette', title: () => _('Appearance'),
        sub: () => _('Colors, wallpaper, fonts'), tone: 'pink',
        keywords: 'appearance theme tema warna color accent aksen dark gelap wallpaper latar font text size teks cursor kursor animasi animation',
    },
    notifications: {
        file: 'notifications', icon: 'notifications', title: () => _('Notifications'),
        sub: () => _('Banners, lock screen'), tone: 'amber',
        keywords: 'notifications notifikasi banner do not disturb jangan ganggu lock screen',
    },
    search: {
        file: 'search', icon: 'search', title: () => _('Search'),
        sub: () => _('Overview search providers'), tone: 'sky',
        keywords: 'search pencarian providers sumber',
    },
    multitasking: {
        file: 'multitasking', icon: 'view_agenda', title: () => _('Multitasking'),
        sub: () => _('Hot corner, tiling, workspaces'), tone: 'violet',
        keywords: 'multitasking workspace hot corner tiling edge sudut panas ruang kerja alt tab',
    },
    apps: {
        file: 'apps', icon: 'apps', title: () => _('Apps'),
        sub: () => _('Default apps, media'), tone: 'green',
        keywords: 'apps aplikasi default browser mail email calendar music video photos removable media autorun',
    },
    privacy: {
        file: 'privacy', icon: 'shield_lock', title: () => _('Privacy & Security'),
        sub: () => _('Screen lock, location, history'), tone: 'sky',
        keywords: 'privacy privasi security keamanan lock kunci location lokasi camera kamera microphone mikrofon usb recent files trash sampah history riwayat',
    },
    sharing: {
        file: 'sharing', icon: 'share', title: () => _('Sharing'),
        sub: () => _('Device name, remote access'), tone: 'green',
        keywords: 'sharing berbagi remote desktop rdp vnc screen sharing ssh',
    },
    display: {
        file: 'display', icon: 'desktop_windows', title: () => _('Displays'),
        sub: () => _('Resolution, scale, Night Light'), tone: 'amber',
        keywords: 'display layar monitor resolution resolusi scale skala refresh night light cahaya malam rotation',
    },
    sound: {
        file: 'sound', icon: 'volume_up', title: () => _('Sound'),
        sub: () => _('Volume, system sounds'), tone: 'pink',
        keywords: 'sound suara volume audio microphone mikrofon speaker output input alert',
    },
    power: {
        file: 'power', icon: 'battery_charging_full', title: () => _('Power'),
        sub: () => _('Power mode, battery'), tone: 'green',
        keywords: 'power daya battery baterai suspend sleep screen blank dim performance saver profile',
    },
    mouse: {
        file: 'mouse', icon: 'mouse', title: () => _('Mouse & Touchpad'),
        sub: () => _('Pointer, scrolling, touchpad'), tone: 'gray',
        keywords: 'mouse touchpad tetikus pointer speed scroll tap click',
    },
    keyboard: {
        file: 'keyboard', icon: 'keyboard', title: () => _('Keyboard'),
        sub: () => _('Typing, layouts'), tone: 'gray',
        keywords: 'keyboard papan ketik shortcuts pintasan layout input source compose key repeat',
    },
    appearanceFonts: {
        file: 'fonts', icon: 'text_fields', title: () => _('Fonts and themes'),
        sub: () => _('Fonts, icons, cursor'), tone: 'pink', parent: 'appearance', hidden: true,
        keywords: 'font fonts huruf icon ikon cursor kursor theme tema',
    },
    shortcuts: {
        file: 'shortcuts', icon: 'keyboard_command_key', title: () => _('Keyboard shortcuts'),
        sub: () => _('Windows, navigation, launchers'), tone: 'gray',
        keywords: 'shortcuts pintasan keyboard papan ketik keybindings hotkeys screenshot tangkapan layar',
    },
    other: {
        file: 'other', icon: 'more_vert', title: () => _('More Settings'),
        sub: () => _('Users, printers, accounts'), tone: 'gray',
        keywords: 'printers pencetak users pengguna online accounts akun color warna thunderbolt',
    },
    datetime: {
        file: 'datetime', icon: 'schedule', title: () => _('Date & Time'),
        sub: () => _('Clock, time zone'), tone: 'amber',
        keywords: 'date time tanggal waktu timezone zona clock jam ntp 24 hour',
    },
    region: {
        file: 'region', icon: 'language', title: () => _('Region & Language'),
        sub: () => _('Formats, language'), tone: 'sky',
        keywords: 'region language bahasa formats locale format',
    },
    accessibility: {
        file: 'accessibility', icon: 'accessibility_new', title: () => _('Accessibility'),
        sub: () => _('Seeing, hearing, typing'), tone: 'violet',
        keywords: 'accessibility aksesibilitas contrast kontras zoom screen reader sticky keys visual alerts large text',
    },
    storage: {
        file: 'storage', icon: 'hard_drive', title: () => _('Storage'),
        sub: () => _('Disk usage'), tone: 'amber',
        keywords: 'storage penyimpanan disk trash sampah temporary files cleanup',
    },
    extension: {
        file: 'extension', icon: 'auto_awesome', title: () => _('Material 3'),
        sub: () => _('Panels, dock, menus, borders'), tone: 'violet',
        keywords: 'material3 material 3 extension ekstensi quick settings dock app menu context menu border radius size ukuran shadow bayangan alt tab osd desktop icons ikon date menu',
    },
    about: {
        file: 'about', icon: 'info', title: () => _('About'),
        sub: () => _('Device and software'), tone: 'gray',
        keywords: 'about tentang system sistem device name nama perangkat hardware cpu memory ram version',
    },
};

/** Sidebar groups, like GNOME Settings. */
export const groups = () => [
    {title: _('Connections'), pages: ['network', 'bluetooth']},
    {title: _('Personal'), pages: ['appearance', 'notifications', 'search', 'multitasking', 'apps', 'privacy', 'sharing']},
    {title: _('Hardware'), pages: ['display', 'sound', 'power', 'mouse', 'keyboard', 'shortcuts', 'other']},
    {title: _('System'), pages: ['datetime', 'region', 'accessibility', 'storage', 'about']},
    {title: _('Extension'), pages: ['extension']},
];

/** GNOME Settings panel names (command line) -> page. */
export const PANEL_ALIASES = {
    wifi: 'network', network: 'network', ethernet: 'network', vpn: 'network', proxy: 'network',
    bluetooth: 'bluetooth',
    background: 'appearance', appearance: 'appearance',
    notifications: 'notifications',
    search: 'search',
    multitasking: 'multitasking',
    applications: 'apps', 'default-apps': 'apps', 'removable-media': 'apps',
    privacy: 'privacy', location: 'privacy', usb: 'privacy', lock: 'privacy', camera: 'privacy', microphone: 'privacy',
    sharing: 'sharing',
    display: 'display', displays: 'display', 'night-light': 'display',
    sound: 'sound',
    power: 'power',
    mouse: 'mouse', touchpad: 'mouse',
    keyboard: 'keyboard', shortcuts: 'shortcuts', 'keyboard-shortcuts': 'shortcuts',
    printers: 'other', 'online-accounts': 'other', users: 'other', color: 'other', wacom: 'other',
    datetime: 'datetime', 'date-time': 'datetime', system: 'datetime',
    region: 'region', 'language': 'region',
    'universal-access': 'accessibility', accessibility: 'accessibility',
    storage: 'storage', 'disk-space': 'storage',
    about: 'about', info: 'about', 'info-overview': 'about',
};
