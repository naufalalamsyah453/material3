import {_} from '../i18n.js';
import {EXT_SCHEMA} from '../sys.js';
import {heading, listCard, rowsFrom, sectionLabel, vbox} from '../ui.js';
import {BORDER_COLORS, componentSpec, globalSpec} from '../../componentSpec.js';

/** One component-spec row as a row of this app (null for a key this version of the schema lacks). */
function specRow(spec, iconName = null) {
    const base = {schema: EXT_SCHEMA, key: spec.key, title: spec.title, sub: spec.sub ?? '', icon: iconName};
    switch (spec.k) {
    case 'switch':
        return {t: 'switch', ...base};
    case 'choice':
        return {t: 'select', ...base, options: spec.values.map((value, i) => [value, spec.labels[i]])};
    case 'num':
        return {
            t: 'slider', ...base, caption: spec.sub ?? '', min: spec.min, max: spec.max, step: spec.step,
            integer: !!spec.integer,
            format: spec.integer ? v => `${Math.round(v)}` : v => v.toFixed(spec.digits),
        };
    case 'font':
        return {t: 'font', ...base};
    default:
        return null;
    }
}

export function build() {
    const page = vbox(16);
    page.append(heading(_('Material 3'), _('Every component of the extension: switch, size and border')));

    page.append(sectionLabel(_('Look and feel')));
    page.append(listCard(rowsFrom([
        {t: 'select', schema: EXT_SCHEMA, key: 'name-source', title: _('Name in Quick Settings'),
            icon: 'badge', options: [
                ['real-name', _('Full name')], ['username', _('Username')],
                ['hostname', _('Computer name')], ['custom', _('Custom')]]},
        {t: 'entry', schema: EXT_SCHEMA, key: 'custom-name', title: _('Custom name'), icon: 'edit'},
        ...globalSpec(_).map(spec => specRow(spec)),
    ])));

    for (const component of componentSpec(_)) {
        page.append(sectionLabel(component.title));
        const rows = [];
        if (component.toggle)
            rows.push(specRow({k: 'switch', ...component.toggle}, component.icon));
        for (const spec of component.rows)
            rows.push(specRow(spec));
        if (component.border) {
            const id = component.border;
            rows.push(
                specRow({k: 'num', key: `border-${id}-width`, title: _('Border width'), min: 0, max: 4, step: 1,
                    digits: 0, integer: true}),
                specRow({k: 'num', key: `border-${id}-radius`, title: _('Corner radius'), min: 0, max: 48, step: 2,
                    digits: 0, integer: true}),
                specRow({k: 'choice', key: `border-${id}-color`, title: _('Border color'),
                    values: BORDER_COLORS, labels: [_('Outline'), _('Accent'), _('Secondary'), _('Text')]}));
        }
        page.append(listCard(rowsFrom(rows)));
    }

    page.append(sectionLabel(_('App menu categories')));
    page.append(listCard(rowsFrom([
        {t: 'switch', schema: EXT_SCHEMA, key: 'favorite-category-enabled',
            title: _('Load only the favorite category'), icon: 'star'},
        {t: 'entry', schema: EXT_SCHEMA, key: 'favorite-category', title: _('Favorite category'),
            sub: _('The category the app menu opens on'), icon: 'bookmark'},
    ])));
    return page;
}
