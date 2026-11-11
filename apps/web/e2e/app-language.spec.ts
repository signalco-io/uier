import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn, uniqueEmail, hydrated } from './support/app';
import { loadAppCatalog } from '../src/lib/i18n/catalog';
import { createAppTranslator } from '../src/lib/i18n/translate';
import { appLanguages, type AppLanguage } from '../src/lib/i18n/languages';

const translator = async (language: AppLanguage) => createAppTranslator(await loadAppCatalog(language));
const section = (page: Page) => page.locator('#app-language');

async function choose(section: Locator, page: Page, label: string, save: string) {
    await hydrated(section.locator('form'));
    await section.getByRole('combobox').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await section.getByRole('button', { name: save, exact: true }).click();
}

for (const language of appLanguages) {
    test(`browser language ${language} reaches the app sign-in page before hydration`, async ({ browser, baseURL }) => {
        const t = await translator(language);
        const context = await browser.newContext({ baseURL, locale: `${language}-${language.toUpperCase()}` });
        const page = await context.newPage();
        const response = await page.goto('/app/sign-in');
        await expect(page.getByRole('heading', { name: t('Sign in'), exact: true })).toBeVisible();
        await expect(page.locator('[data-app-language]')).toHaveAttribute('lang', language);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const html = await response!.text();
        expect(html).toContain(`lang="${language}"`);
        await context.close();
    });
}

test('unsupported browser languages use English', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto('/app/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('[data-app-language]')).toHaveAttribute('lang', 'en');
    await context.close();
});

test('profile choice survives reload, follows the account and resets to the browser independently of toolbar language', async ({ page, context, browser, baseURL }) => {
    await signIn(page, uniqueEmail('app-language'));
    const de = await translator('de');
    const fr = await translator('fr');
    await page.goto('/app/account');
    await choose(section(page), page, 'Deutsch', 'Save');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(section(page).getByRole('status')).toHaveText(de('Your app language is saved.'));
    await expect(page.locator('#toolbar-language').getByRole('combobox')).toContainText(de('Project default'));
    await page.reload();
    await expect(section(page).getByRole('combobox')).toContainText('Deutsch');

    // The preference is account-wide, including another browser with French as its own default.
    const other = await browser.newContext({ baseURL, locale: 'fr-FR' });
    await other.addCookies(await context.cookies());
    const otherPage = await other.newPage();
    await otherPage.goto('/app/account');
    await expect(otherPage.locator('html')).toHaveAttribute('lang', 'de');
    await expect(otherPage.getByRole('heading', { name: de('Account'), exact: true })).toBeVisible();
    await choose(section(otherPage), otherPage, 'English', de('Save'));
    await expect(otherPage.locator('html')).toHaveAttribute('lang', 'en');
    await otherPage.reload();
    await expect(section(otherPage).getByRole('combobox')).toContainText('English');
    await choose(section(otherPage), otherPage, 'Browser default', 'Save');
    await expect(otherPage.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(section(otherPage).getByRole('combobox')).toContainText(fr('Browser default'));
    await expect(otherPage.locator('#toolbar-language').getByRole('combobox')).toContainText(fr('Project default'));
    await otherPage.getByRole('link', { name: fr('Projects'), exact: true }).first().click();
    await expect(otherPage).toHaveURL(/\/app\/projects/);
    await expect(otherPage.locator('html')).toHaveAttribute('lang', 'fr');
    await other.close();
});

test('a delayed language save disables further choices and a failed save keeps the saved preference', async ({ page }) => {
    await signIn(page, uniqueEmail('app-language-save'));
    await page.goto('/app/account');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let writes = 0;
    await page.route('**/app/account', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        writes++;
        await held;
        await route.continue();
    });
    try {
        await choose(section(page), page, 'Deutsch', 'Save');
        await expect.poll(() => writes).toBe(1);
        await expect(section(page).getByRole('combobox')).toBeDisabled();
        await expect(section(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
        release();
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    } finally { release(); }
    await page.unroute('**/app/account');
    const de = await translator('de');
    await page.route('**/app/account', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        // Invalid preference reaches server validation while preserving the action's normal transport.
        const original = route.request().postDataBuffer()!;
        const tampered = Buffer.from(original.toString().replace(/\r\nfr\r\n/g, '\r\npt\r\n'));
        await route.continue({ postData: tampered });
    });
    await choose(section(page), page, 'Français', de('Save'));
    await expect(section(page).getByRole('alert')).toHaveText(de('Choose a language.'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.unroute('**/app/account');
    await page.reload();
    await expect(section(page).getByRole('combobox')).toContainText('Deutsch');
});
