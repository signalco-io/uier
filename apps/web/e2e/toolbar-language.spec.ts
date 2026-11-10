import { expect, test, type Locator, type Page } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';

// The toolbar's language (docs/project-settings.md#toolbar-language): a project's language reaches every
// reviewer, a guest's own choice stays in their browser, a member's is saved to their account, and Default
// goes back to the project's. English is part of the review script; the other languages load as assets.

let site: Awaited<ReturnType<typeof startReviewedSite>>;

test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
});

test.afterAll(async () => {
    await site.close();
});

/** Fails the test when the page reports a CSP violation (the install guide's sources load the languages too) */
function watchCsp(page: Page) {
    const violations: string[] = [];
    page.on('console', message => {
        if (/Content Security Policy/i.test(message.text()))
            violations.push(message.text());
    });
    return violations;
}

/** The `lang` the toolbar's root names, for screen readers */
const toolbarLang = (control: Locator) => control.evaluate(element => element.closest('[lang]')?.getAttribute('lang'));

/** Opens the toolbar's Options, then its Language view */
async function openLanguages(page: Page, options: string, language: string) {
    await page.getByRole('button', { name: options, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${language}`) }).click();
    return page.getByRole('group', { name: language, exact: true });
}

/** Sets a select of the app's settings and saves its section */
async function chooseSetting(section: Locator, page: Page, field: string, option: string) {
    await hydrated(section.locator('form'));
    await section.getByRole('combobox', { name: field }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(section.getByRole('status').filter({ hasText: /Saved|saved/ })).toBeVisible();
}

test('a project’s language reaches guests; a guest’s own choice stays in their browser until Default', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('owner'));
    const projectId = await createProject(page, { urls: [site.origin()], name: 'Reviewed site' });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const review = page.getByRole('region', { name: 'Review', exact: true });
    // Existing workspaces are English; the project chooses German
    await expect(review.getByRole('combobox', { name: 'Toolbar language' })).toContainText('Workspace default (English)');
    await chooseSetting(review, page, 'Toolbar language', 'German (Deutsch)');

    const guest = await newVisitor(browser, testInfo);
    const violations = watchCsp(guest.page);
    await guest.page.goto(`${site.origin()}/${projectId}/?toolbar-code=${projectId}`);
    const addComment = guest.page.getByRole('button', { name: 'Kommentar hinzufügen' });
    await expect(addComment).toBeVisible();
    await expect(guest.page.getByRole('group', { name: 'uier-Feedback-Leiste' })).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'Add comment' })).toHaveCount(0);
    expect(await toolbarLang(addComment)).toBe('de');

    // The guest chooses English: shown at once, kept in this browser, never sent to the server
    let saved = false;
    guest.page.on('request', request => { if (/\/language$/.test(new URL(request.url()).pathname)) saved = true; });
    let languages = await openLanguages(guest.page, 'Optionen', 'Sprache');
    await expect(languages.getByRole('button', { name: 'Standard (Deutsch)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.page.getByText('Ihre Auswahl bleibt in diesem Browser.')).toBeVisible();
    await languages.getByRole('button', { name: 'English', exact: true }).click();
    languages = guest.page.getByRole('group', { name: 'Language', exact: true });
    await expect(languages.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(guest.page.getByText("Default is the project's language.")).toBeVisible();
    expect(await guest.page.evaluate(() => localStorage.getItem('uier:toolbar-language'))).toBe('en');
    await guest.page.keyboard.press('Escape');
    await guest.page.reload();
    await expect(guest.page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    expect(await toolbarLang(guest.page.getByRole('button', { name: 'Add comment' }))).toBe('en');

    // Another language loads as its own asset; Default goes back to the project's
    languages = await openLanguages(guest.page, 'Options', 'Language');
    await languages.getByRole('button', { name: 'Hrvatski', exact: true }).click();
    await expect(guest.page.getByRole('button', { name: 'Dodaj komentar' })).toBeVisible();
    languages = guest.page.getByRole('group', { name: 'Jezik', exact: true });
    await languages.getByRole('button', { name: 'Zadano (Deutsch)' }).click();
    await expect(guest.page.getByRole('button', { name: 'Kommentar hinzufügen' })).toBeVisible();
    expect(await guest.page.evaluate(() => localStorage.getItem('uier:toolbar-language'))).toBeNull();
    expect(saved).toBe(false);
    expect(violations).toEqual([]);
    await guest.context.close();
});

test('a member’s choice in the toolbar is saved to their account, shown in Account and reset there', async ({ page }) => {
    await signIn(page, uniqueEmail('member'));
    const projectId = await createProject(page, { urls: [site.origin()], name: 'Reviewed site' });
    const target = `/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`;
    await page.goto(target);
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();

    const languages = await openLanguages(page, 'Options', 'Language');
    await expect(page.getByText('Your choice is saved to your uier account.')).toBeVisible();
    const saved = page.waitForResponse(response => /\/api\/review\/[^/]+\/language$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
    await languages.getByRole('button', { name: 'Italiano', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Aggiungi commento' })).toBeVisible();

    // The account has it: Account → Toolbar language shows it, and Project default resets it
    await page.goto('/app/account');
    const section = page.getByRole('region', { name: 'Toolbar language', exact: true });
    await expect(section.getByRole('combobox', { name: 'Language' })).toContainText('Italian (Italiano)');
    await chooseSetting(section, page, 'Language', 'Project default');

    await page.goto(target);
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aggiungi commento' })).toHaveCount(0);
});


for (const fails of [false, true]) {
    test(`account language choices wait for a delayed ${fails ? 'failed' : 'successful'} save`, async ({ page }) => {
        await signIn(page, uniqueEmail('language-race'));
        const projectId = await createProject(page, { urls: [site.origin()], name: 'Reviewed site' });
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
        await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();
        await openLanguages(page, 'Options', 'Language');
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let writes = 0;
        await page.route(`**/api/review/${projectId}/language`, async route => {
            writes++;
            if (writes === 1) {
                await held;
                if (fails) {
                    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'save_failed' }) });
                    return;
                }
            }
            await route.continue();
        });
        try {
            await page.getByRole('button', { name: 'Deutsch', exact: true }).click();
            await expect.poll(() => writes).toBe(1);
            const french = page.getByRole('button', { name: 'Français', exact: true });
            await expect(french).toBeDisabled();
            // A second choice cannot be sent while the first account write is outstanding.
            await french.dispatchEvent('click');
            expect(writes).toBe(1);
            const firstSaved = page.waitForResponse(response => response.url().endsWith(`/api/review/${projectId}/language`));
            release();
            expect((await firstSaved).status()).toBe(fails ? 500 : 200);
            await expect(french).toBeEnabled();
            if (fails) await expect(page.getByRole('button', { name: 'Default (English)', exact: true })).toHaveAttribute('aria-pressed', 'true');
            else await expect(page.getByRole('button', { name: 'Deutsch', exact: true })).toHaveAttribute('aria-pressed', 'true');
            const secondSaved = page.waitForResponse(response => response.url().endsWith(`/api/review/${projectId}/language`));
            await french.click();
            expect((await secondSaved).status()).toBe(200);
            await expect(page.getByRole('button', { name: 'Ajouter un commentaire', exact: true })).toBeVisible();
            await page.goto('/app/account');
            await expect(page.getByRole('region', { name: 'Toolbar language', exact: true }).getByRole('combobox', { name: 'Language' })).toContainText('French (Français)');
            expect(writes).toBe(2);
        } finally {
            release();
        }
    });
}
