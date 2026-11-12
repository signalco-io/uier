import { expect, test } from '@playwright/test';
import { describeAccessEvent, type ActivityNames } from '../src/components/app/teams/activityText';
import { pluralText } from '../src/components/app/teams/pluralText';
import { createAppTranslator, englishAppTranslator } from '../src/lib/i18n/translate';
import type { DbAccessEvent } from '../src/lib/app/model';
import de from '../src/lib/i18n/catalogs/management/de';
import fr from '../src/lib/i18n/catalogs/management/fr';
import es from '../src/lib/i18n/catalogs/management/es';
import it from '../src/lib/i18n/catalogs/management/it';
import hr from '../src/lib/i18n/catalogs/management/hr';

test('Croatian management counts use one, few and other, while English keeps its visible source phrases', () => {
    const t = createAppTranslator(hr);
    for (const [count, expected] of [[1, '1 osoba'], [2, '2 osobe'], [4, '4 osobe'], [5, '5 osoba'], [11, '11 osoba'], [21, '21 osoba'], [22, '22 osobe']] as const)
        expect(pluralText(t, 'hr', count, '{count} person', '{count} people')).toBe(expected);
    for (const [count, expected] of [[0, '0 people'], [1, '1 person'], [2, '2 people'], [21, '21 people']] as const)
        expect(pluralText(englishAppTranslator, 'en', count, '{count} person', '{count} people')).toBe(expected);
});

test('access activity translates presentation while keeping actor and user-defined names unchanged', () => {
    const names: ActivityNames = {
        people: new Map([['u_actor', 'Settings']]),
        invitations: new Map(), teams: new Map(), projects: new Map()
    };
    const event: DbAccessEvent = {
        type: 'access-event', id: 'access_localized', pk: 'workspace:w_example', workspaceId: 'w_example',
        actorId: 'u_actor', at: '2026-11-11T00:00:00Z', action: 'team.updated', targetIds: ['team_example'],
        before: { name: 'Projects' }, after: { name: 'Review' }, ttl: 1
    };
    const result = describeAccessEvent(event, names, createAppTranslator(hr), 'hr');
    expect(result.actor).toBe('Settings');
    expect(result.text).toContain('Projects');
    expect(result.text).toContain('Review');
    expect(result.text).not.toContain('Projekti');
    expect(result.text).not.toContain('team_example');
    expect(result.text).not.toBe('renamed the team Projects to Review');
    expect(describeAccessEvent(event, names).text).toBe('renamed the team Projects to Review');
});

test('installation platform names remain recognizable in every management language', () => {
    for (const catalog of [de, fr, es, it, hr])
        for (const name of ['HTML', 'React', 'Next.js', 'WordPress', 'Webflow', 'Shopify'] as const)
            expect(catalog[name]).toBe(name);
});
