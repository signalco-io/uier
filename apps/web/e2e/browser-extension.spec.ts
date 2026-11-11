import { expect, test, type Page } from '@playwright/test';
import { brand } from '@uier/brand';
import { KnownPages } from '../src/knownPages';
import { extensionRelease, extensionStoreUrl, firefoxExtensionRelease } from '../src/lib/extension/release';
import { guides } from '../src/lib/guides';
import { assertAccessibility } from './accessibility';

// Content of the browser extension pages (#308). browser-extension.api.spec.ts checks the store link;
// seo.api.spec.ts and social-cards.api.spec.ts check their metadata, sitemap entries and cards.

async function expectStoreLink(page: Page) {
    await expect(page.getByRole('main').getByRole('link', { name: extensionRelease.storeLabel })).toHaveAttribute('href', extensionStoreUrl);
    await expect(page.getByRole('main').getByText(firefoxExtensionRelease.availabilityMessage, { exact: true })).toBeVisible();
    await expect(page.locator('main a[href*="addons.mozilla.org"]')).toHaveCount(0);
}

async function expectSocialMetadata(page: Page, path: string, title: string) {
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new URL(path, brand.url).href);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', `${title} · ${brand.name}`);
    // This page's own card, not the brand card; Next adds a build hash to its name
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`^${brand.url}${path}/opengraph-image-`));
}

test('the extension page explains the review path, its limits and permissions', async ({ page }) => {
    expect((await page.goto(KnownPages.BrowserExtension))?.status()).toBe(200);
    await expect(page).toHaveTitle(`Browser extension · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Browser extension' })).toBeVisible();
    await expectStoreLink(page);
    await expect(page.getByRole('main').getByRole('link', { name: 'Read the setup guide' })).toHaveAttribute('href', guides.browserExtension.path);
    // The cover: each browser's official logo, decorative, with its name written under it; Firefox is in review
    const cover = page.getByRole('list', { name: 'Browsers', exact: true });
    await expect(cover.getByRole('listitem')).toHaveText(['Chrome', 'Microsoft Edge', 'FirefoxIn review']);
    await expect(cover.locator('img[alt=""][aria-hidden="true"]')).toHaveCount(3);
    for (const logo of await cover.locator('img').all()) expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    // Only the browsers the manifest supports, near the top
    await expect(page.getByRole('list', { name: 'Supported browsers, on desktop:' }).getByRole('listitem'))
        .toHaveText([`Chrome ${extensionRelease.minimumBrowserVersion} or later`, `Microsoft Edge ${extensionRelease.minimumBrowserVersion} or later`]);
    // The popup and the toolbar are pictures with visible captions
    await expect(page.getByRole('figure')).toHaveCount(2);
    const steps = page.getByRole('region', { name: 'How it works' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    for (const label of [extensionRelease.labels.signIn, extensionRelease.labels.start, extensionRelease.labels.exit])
        await expect(steps.getByText(label, { exact: true }).first()).toBeVisible();
    // The names of the app's setup tabs (InstallGuide)
    await expect(page.getByRole('region', { name: 'Script or extension' }).getByRole('heading', { level: 3 })).toHaveText(['Install the script', 'Use the browser extension']);
    await expect(page.getByRole('region', { name: 'Where it works' })).toContainText('Not supported: Safari and mobile browsers');
    await expect(page.getByRole('region', { name: 'Where it works' })).toContainText(`Firefox ${firefoxExtensionRelease.minimumBrowserVersion} or later`);
    const privacy = page.getByRole('region', { name: 'Permissions and privacy' });
    await expect(privacy).toContainText('It cannot read your cookies or history');
    await expect(privacy).toContainText('The site’s address, to find projects you can access.');
    await expect(privacy).toContainText('It stays signed in across browser restarts');
    await expect(page.getByText(brand.pricing, { exact: true })).toBeVisible();
    await expectSocialMetadata(page, KnownPages.BrowserExtension, 'Browser extension');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await assertAccessibility(page, KnownPages.BrowserExtension);
});

test('the setup guide covers installation, reviews, links, headers, screenshots and problems', async ({ page }) => {
    const path = guides.browserExtension.path;
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page).toHaveTitle(`${guides.browserExtension.title} · ${brand.name}`);
    await expect(page.getByRole('heading', { level: 1, name: guides.browserExtension.title })).toBeVisible();
    await expectStoreLink(page);
    await expect(page.getByRole('main').getByRole('link', { name: 'About the extension' })).toHaveAttribute('href', KnownPages.BrowserExtension);
    for (const section of ['Before you start', 'Install the extension', 'Review a site', 'Comment links', 'Strict security headers', 'Screenshots', 'Common problems', 'Get help'])
        await expect(page.getByRole('region', { name: section }), section).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install the extension' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Install the extension' }).getByRole('heading', { level: 3, name: 'Firefox', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install the extension' })).toContainText('Firefox Browser Add-ons');
    await expect(page.getByRole('region', { name: 'Screenshots' }).getByText(extensionRelease.omitScreenshot, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Common problems' }).getByRole('heading', { level: 3 })).toHaveCount(8);
    await expect(page.getByRole('region', { name: 'Common problems' }).getByRole('link', { name: 'service status' })).toHaveAttribute('href', KnownPages.Status);
    await expectSocialMetadata(page, path, guides.browserExtension.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the footer, guides, homepage and stack question link the extension', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Browser extension' })).toHaveAttribute('href', KnownPages.BrowserExtension);
    await expect(page.locator(`main section[aria-labelledby="get-started"] a[href="${KnownPages.BrowserExtension}"]`)).toBeVisible();
    const browsers = page.locator('main section[aria-labelledby="get-started"]').getByRole('list', { name: 'Browser extension' });
    for (const name of ['Chrome', 'Edge']) await expect(browsers.getByRole('link', { name, exact: true })).toHaveAttribute('href', extensionStoreUrl);
    await expect(browsers.getByRole('listitem').filter({ hasText: 'Firefox' })).toHaveText('Firefoxin review');
    await expect(browsers.getByRole('link')).toHaveCount(2);
    const question = page.getByRole('region', { name: 'Questions' }).locator('details').filter({ hasText: 'Does it work with my stack?' });
    await question.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(question.getByRole('link', { name: 'browser extension' })).toHaveAttribute('href', KnownPages.BrowserExtension);
    await page.goto(KnownPages.Guides);
    await expect(page.locator(`main a[href="${guides.browserExtension.path}"]`)).toBeVisible();
});
