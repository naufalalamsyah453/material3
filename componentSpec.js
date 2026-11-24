/**
 * Every setting of the extension, per component, in one place. The
 * extension's preferences window (prefs.js) and the Settings app (app/pages/
 * extension.js) both draw their rows from this list, so they always offer
 * the same options.
 *
 * Row kinds: `switch`, `choice` (values/labels), `num` (a number with a range),
 * `font`. A component may have a `toggle` (the key that turns it on or off) and
 * a `border` (the surface id of its border width, radius and color keys).
 *
 * @param {function(string): string} _ translator
 */
export function componentSpec(_) {
    const sizes = {step: 0.05, digits: 2};
    return [
        {
            id: 'qs', icon: 'toggle_on', title: _('Quick Settings'),
            sub: _('The panel from the system menu in the top bar'),
            toggle: {key: 'show-quicksettings', title: _('Use Material 3 Quick Settings'),
                sub: _('Off restores GNOME\'s own panel')},
            border: 'qs',
            rows: [
                {k: 'choice', key: 'qs-tile-style', title: _('Tile style'),
                    sub: _('In the split style only tiles that have options are divided'),
                    values: ['classic', 'split'], labels: [_('Classic'), _('Split')]},
                {k: 'choice', key: 'qs-slider-style', title: _('Slider style'),
                    values: ['classic', 'handle'], labels: [_('Classic'), _('Handle')]},
                {k: 'choice', key: 'qs-media-style', title: _('Media player style'),
                    values: ['classic', 'cover'], labels: [_('Classic'), _('Cover')]},
                {k: 'num', key: 'ui-scale', title: _('Size'), sub: _('1.00 is the default size'),
                    min: 0.75, max: 1.5, ...sizes},
                {k: 'num', key: 'font-scale', title: _('Text size'),
                    sub: _('Extra text scale on top of the size'), min: 0.8, max: 1.4, ...sizes},
                {k: 'font', key: 'font-family', title: _('Font'), fallback: _('Default (Plus Jakarta Sans)'),
                    reset: _('Use the default font')},
            ],
        },
        {
            id: 'dock', icon: 'dock_to_bottom', title: _('Dock'),
            sub: _('The bar with your apps and the window previews above it'),
            toggle: {key: 'show-dock', title: _('Show dock'), sub: _('Off hides the dock and the app menu button')},
            border: 'dock',
            rows: [
                {k: 'choice', key: 'dock-mode', title: _('Dock behavior'),
                    sub: _('Static keeps the dock in view and stops maximized windows above it'),
                    values: ['static', 'autohide'], labels: [_('Static'), _('Auto-hide')]},
                {k: 'num', key: 'dock-scale', title: _('Size'), sub: _('1.00 is the default size'),
                    min: 0.7, max: 1.6, ...sizes},
                {k: 'num', key: 'dock-margin', title: _('Height above the edge'),
                    sub: _('Gap between the dock and the bottom edge of the screen, in pixels'),
                    min: 0, max: 96, step: 2, digits: 0, integer: true},
                {k: 'num', key: 'preview-scale', title: _('Window preview size'),
                    sub: _('Size of the preview shown when hovering a dock icon'), min: 0.6, max: 2.0, ...sizes},
                {k: 'choice', key: 'dock-end-button', title: _('End button'),
                    sub: _('The button at the end of the dock'),
                    values: ['none', 'theme', 'settings'], labels: [_('None'), _('Theme switch'), _('Settings shortcut')]},
            ],
        },
        {
            id: 'appmenu', icon: 'apps', title: _('App menu'),
            sub: _('The launcher opened from the dock'),
            toggle: {key: 'show-appmenu', title: _('Use Material 3 app menu'),
                sub: _('Off opens GNOME\'s Overview from the dock and the Super key')},
            border: 'appmenu',
            rows: [
                {k: 'num', key: 'appmenu-scale', title: _('Size'), sub: _('1.00 is the default size'),
                    min: 0.7, max: 1.5, ...sizes},
                {k: 'num', key: 'appmenu-width', title: _('Width'),
                    sub: _('Width of the app menu in pixels; the app cards share it evenly'),
                    min: 360, max: 900, step: 10, digits: 0, integer: true},
                {k: 'num', key: 'appmenu-height', title: _('Grid height'),
                    sub: _('Height of the scrolling app grid, in pixels'),
                    min: 120, max: 640, step: 10, digits: 0, integer: true},
                {k: 'choice', key: 'appmenu-sort', title: _('Sort order'), sub: _('Order of the apps in the grid'),
                    values: ['name', 'name-desc', 'usage'], labels: [_('Name (A-Z)'), _('Name (Z-A)'), _('Most used')]},
                {k: 'switch', key: 'show-recent', title: _('Recent window card'),
                    sub: _('The card at the bottom that reopens the last used window')},
            ],
        },
        {
            id: 'ctx', icon: 'menu_open', title: _('Context menus'),
            sub: _('The right-click menus of the dock, app menu and desktop'),
            border: 'ctx',
            rows: [
                {k: 'num', key: 'context-scale', title: _('Size'), sub: _('1.00 is the default size'),
                    min: 0.7, max: 1.6, ...sizes},
                {k: 'num', key: 'context-font-scale', title: _('Text size'), min: 0.7, max: 1.6, ...sizes},
                {k: 'font', key: 'context-font-family', title: _('Font'), fallback: _('Same as the Quick Settings font'),
                    reset: _('Use the Quick Settings font')},
                {k: 'switch', key: 'context-show-icons', title: _('Icons'),
                    sub: _('Show an icon before each entry')},
            ],
        },
        {
            id: 'datemenu', icon: 'calendar_month', title: _('Date menu'),
            sub: _('Notifications, calendar, reminders, world clocks and weather'),
            toggle: {key: 'show-datemenu', title: _('Use Material 3 date menu'),
                sub: _('Off restores GNOME\'s own clock menu')},
            border: 'datemenu',
            rows: [
                {k: 'num', key: 'datemenu-scale', title: _('Size'), sub: _('1.00 is the default size'),
                    min: 0.7, max: 1.5, ...sizes},
                {k: 'num', key: 'datemenu-font-scale', title: _('Text size'), min: 0.7, max: 1.5, ...sizes},
            ],
        },
        {
            id: 'switcher', icon: 'tab', title: _('Window switcher'),
            sub: _('The Alt+Tab window list'),
            toggle: {key: 'show-switcher', title: _('Use Material 3 Alt+Tab switcher'),
                sub: _('Off restores GNOME\'s own window switcher')},
            border: 'switcher',
            rows: [
                {k: 'num', key: 'switcher-scale', title: _('Size'), sub: _('Size of the window previews'),
                    min: 0.6, max: 1.6, ...sizes},
            ],
        },
        {
            id: 'osd', icon: 'volume_up', title: _('On-screen display'),
            sub: _('The indicator shown when you change the volume or brightness'),
            toggle: {key: 'osd-enabled', title: _('Use Material 3 indicator'),
                sub: _('Off restores the shell\'s own on-screen display')},
            border: 'osd',
            rows: [
                {k: 'num', key: 'osd-scale', title: _('Size'), min: 0.7, max: 1.6, ...sizes},
            ],
        },
        {
            id: 'desktop', icon: 'desktop_windows', title: _('Desktop icons'),
            sub: _('The files of your Desktop folder on the desktop'),
            toggle: {key: 'show-desktop-icons', title: _('Show desktop icons'),
                sub: _('Needs no other extension')},
            border: 'desktop', borderTitle: _('Selection border'),
            rows: [
                {k: 'num', key: 'desktop-icon-size', title: _('Icon size'), sub: _('Size of the icons in pixels'),
                    min: 32, max: 128, step: 4, digits: 0, integer: true},
                {k: 'switch', key: 'desktop-show-home', title: _('Home'), sub: _('A shortcut to your home folder')},
                {k: 'switch', key: 'desktop-show-trash', title: _('Trash'), sub: _('A shortcut to the trash')},
            ],
        },
        {
            id: 'prompt', icon: 'monitor', title: _('Display prompt'),
            sub: _('"Keep these display settings?" after a change in Displays'),
            toggle: {key: 'show-display-prompt', title: _('Use Material 3 prompt'),
                sub: _('Off shows the shell\'s own prompt')},
            border: 'prompt',
            rows: [],
        },
        {
            id: 'settings', icon: 'settings', title: _('Settings app'),
            sub: _('The Material 3 replacement for GNOME Settings'),
            toggle: {key: 'show-settings', title: _('Replace GNOME Settings'),
                sub: _('Open the Material 3 Settings app instead of GNOME Settings')},
            border: 'settings',
            rows: [
                {k: 'choice', key: 'settings-sidebar-style', title: _('Sidebar buttons'),
                    sub: _('Look of the page list'),
                    values: ['cards', 'pills'], labels: [_('Cards with colored icons'), _('Compact pills')]},
            ],
        },
    ];
}

/** Settings that belong to no single component. */
export function globalSpec(_) {
    return [
        {k: 'switch', key: 'disable-shadows', title: _('Disable shadows'),
            sub: _('No drop shadows on any surface of the extension')},
        {k: 'num', key: 'anim-scale', title: _('Animation speed'),
            sub: _('1.00 is the default, 0 turns the animations off'), min: 0, max: 2, step: 0.1, digits: 1},
        {k: 'switch', key: 'theme-shell', title: _('Color the shell'),
            sub: _('Top bar, menus and notifications use the theme colors (dark mode)')},
        {k: 'switch', key: 'theme-apps', title: _('Color GTK apps'),
            sub: _('Writes colors to ~/.config/gtk-4.0 and gtk-3.0; apps pick them up when started')},
    ];
}

export const BORDER_COLORS = ['outline', 'primary', 'secondary', 'text'];
