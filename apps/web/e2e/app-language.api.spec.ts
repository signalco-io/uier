import { describeAccess } from '../src/lib/mcp/oauth/grants';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { appLanguages, browserAppLanguage, resolveAppLanguage } from '../src/lib/i18n/languages';
import { loadAppCatalog } from '../src/lib/i18n/catalog';
import { createAppTranslator } from '../src/lib/i18n/translate';
import { appLanguageSchema, setUserAppLanguage, userAppLanguage } from '../src/lib/app/appLanguage';
import { findOrCreateUser, getUser, updateUserName } from '../src/lib/app/users';
import { setUserToolbarLanguage } from '../src/lib/app/toolbarLanguage';
import { commentAnchor } from '../src/lib/app/commentAnchor';
import { threadHistoryView } from '../src/lib/comments/history';
import type { DbComment } from '../src/lib/db/schema';

const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

test('app languages match the toolbar; explicit choice, browser preferences and English fallback resolve deterministically', () => {
    expect(appLanguages).toEqual(['en', 'de', 'fr', 'es', 'it', 'hr']);
    for (const language of appLanguages) {
        expect(resolveAppLanguage(language, 'fr-FR')).toBe(language);
        expect(browserAppLanguage(`${language.toUpperCase()}-XX`)).toBe(language);
    }
    expect(browserAppLanguage('pt-BR,hr-HR;q=0.8,en;q=0.7')).toBe('hr');
    expect(browserAppLanguage('de;q=0.2,es-MX;q=0.9,fr;q=0.5')).toBe('es');
    expect(browserAppLanguage('it;q=0,fr;q=0.5')).toBe('fr');
    expect(browserAppLanguage('de;q=wat,fr;q=1.5,hr;q=-1,it;q=0.7')).toBe('it');
    expect(browserAppLanguage('de-INVALID-TAG-!;q=1,es;q=0.8')).toBe('es');
    for (const browser of [undefined, null, '', 'pt-BR,ja-JP', '*', 'en;q=0'])
        expect(browserAppLanguage(browser)).toBe('en');
    expect(resolveAppLanguage('unknown', 'fr-CA')).toBe('fr');
    expect(resolveAppLanguage(null, 'it-IT')).toBe('it');
    expect(resolveAppLanguage('en', 'de-DE')).toBe('en');
    expect(userAppLanguage({ appLanguage: 'unknown' as never })).toBeNull();
});

test('account preference is validated and persisted independently of toolbar language and concurrent profile writes', async () => {
    const user = await findOrCreateUser(`app-language-${randomUUID()}@example.test`);
    await setUserToolbarLanguage(user.id, 'it');
    expect(userAppLanguage((await getUser(user.id))!)).toBeNull();
    for (const invalid of ['pt', 'DE', '', 42, {}, undefined]) {
        expect(appLanguageSchema.safeParse(invalid).success).toBe(false);
        await expect(setUserAppLanguage(user.id, invalid)).rejects.toThrow();
    }
    expect((await getUser(user.id))!.appLanguage).toBeUndefined();
    await Promise.all([setUserAppLanguage(user.id, 'de'), updateUserName(user.id, 'Name kept')]);
    expect(await getUser(user.id)).toMatchObject({ name: 'Name kept', appLanguage: 'de', toolbarLanguage: 'it' });
    await setUserAppLanguage(user.id, 'en');
    expect(resolveAppLanguage((await getUser(user.id))!.appLanguage, 'hr-HR')).toBe('en');
    await setUserAppLanguage(user.id, null);
    const reset = (await getUser(user.id))!;
    expect(reset.appLanguage).toBeUndefined();
    expect(reset.toolbarLanguage).toBe('it');
    expect(resolveAppLanguage(reset.appLanguage, 'hr-HR')).toBe('hr');
});

test('all app catalogs are complete and preserve interpolation names', async () => {
    const source = await loadAppCatalog('en');
    for (const key of ["Enable fix verification", "Ask a reviewer to confirm fixes before marking them done. When off, pending checks stay in Open or In progress and can be marked done."]) expect(source[key]).toBe(key);
    const placeholders = (text: string) => [...new Set(text.match(/\{[A-Za-z0-9_]+\}/g) ?? [])].sort();
    expect(Object.keys(source).length).toBeGreaterThan(900);
    for (const language of appLanguages) {
        const catalog = await loadAppCatalog(language);
        expect(Object.keys(catalog).sort(), language).toEqual(Object.keys(source).sort());
        const invalid = Object.entries(catalog).filter(([key, value]) => !value.trim() ||
            JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(key))).map(([key]) => key);
        expect(invalid, `${language}: empty translations or changed placeholders`).toEqual([]);
    }
});

test('interpolation is literal, known service errors translate, and unknown content stays unchanged', async () => {
    const t = createAppTranslator(await loadAppCatalog('de'));
    expect(t('Use at most 80 characters.')).toBe('Verwenden Sie höchstens 80 Zeichen.');
    expect(t('"https://wrong.test" is not a website address.')).toBe('„https://wrong.test“ ist keine Website-Adresse.');
    expect(t('Unknown comment written by a person')).toBe('Unknown comment written by a person');
    const example = createAppTranslator({ 'Hello {name}': 'Bonjour {name}' });
    expect(example('Hello {name}', { name: '$& <b>{other}</b>' })).toBe('Bonjour $& <b>{other}</b>');
    expect(example('Hello {name}')).toBe('Bonjour {name}');
});

test('localized anchors and history keep original people and selected text', async () => {
    const t = createAppTranslator(await loadAppCatalog('de'));
    const anchor = commentAnchor({ type: 'text', text: 'Leave my words unchanged', selector: 'p', start: 0, end: 23 } as never, undefined, undefined, t);
    expect(anchor).toMatchObject({ type: 'text', text: 'Leave my words unchanged' });
    expect(anchor.label).not.toContain('Selected text');
    const at = '2026-11-11T00:00:00.000Z';
    const comment = { authorId: 'user:person', thread: { items: [] }, history: [{ id: 'entry', at, actorId: 'user:person', action: 'assigned', private: false, userId: 'other' }] } as unknown as DbComment;
    const names = new Map([['person', 'Ana'], ['other', 'Luka']]);
    expect(threadHistoryView(comment, { member: true }, names)?.[0]?.description).toBe('Ana assigned Luka.');
    const translated = threadHistoryView(comment, { member: true }, names, t)?.[0]?.description;
    expect(translated).toContain('Ana');
    expect(translated).toContain('Luka');
    expect(translated).not.toContain('assigned');
});


test('English connected-app summaries preserve the existing wording', async () => {
    const access = { kind: 'selected' as const, workspaces: [
        { workspaceId: 'w_one', projects: 'all' as const },
        { workspaceId: 'w_two', projects: ['project_two'] }
    ] };
    const english = { language: 'en' as const, t: createAppTranslator(await loadAppCatalog('en')) };
    expect(describeAccess(access, english)).toBe('2 workspaces, all projects in one, 1 project');
    expect(describeAccess(access, english)).toBe(describeAccess(access));
});
