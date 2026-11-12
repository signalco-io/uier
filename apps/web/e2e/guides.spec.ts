import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { guides } from '../src/lib/guides';
import { nextJsSnippet } from '../src/lib/app/integration';
import { assertAccessibility } from './accessibility';

test('guides link the shipped workflow and show the same Next.js snippet as installation', async ({ page }) => {
    await page.goto('/guides');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Guides', exact: true })).toHaveAttribute('href', '/guides');
    await page.locator(`main a[href="${guides.nextJs.path}"]`).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.nextJs.title })).toBeVisible();
    await expect(page.locator('main pre code')).toHaveText(nextJsSnippet(brand.url, 'YOUR_PROJECT_CODE'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Plan a client review' }).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.clientReviews.title })).toBeVisible();
    await expect(page.locator('main a[href="/features/fix-verification"]')).toBeVisible();
    await expect(page.locator('main a[href="/features/feedback-triage"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('each guide links back to the guides and outlines its sections', async ({ page }) => {
    for (const guide of [guides.clientReviews, guides.nextJs, guides.browserExtension, guides.reviewChecklist, guides.bugReport]) {
        await page.goto(guide.path);
        await expect(page.getByRole('main').getByRole('link', { name: 'Guides', exact: true })).toHaveAttribute('href', guides.index.path);
        const hrefs = await page.getByRole('navigation', { name: 'In this guide' }).getByRole('link')
            .evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''));
        expect(hrefs.length, guide.path).toBeGreaterThan(2);
        for (const href of hrefs) await expect(page.locator(`main section${href}`), `${guide.path}${href}`).toHaveCount(1);
    }
});

for (const guide of Object.values(guides))
    test(`${guide.path} is accessible`, ({ page }) => assertAccessibility(page, guide.path));

test('practical guides have useful scope, examples and working crosslinks', async ({ page }) => {
    await page.goto('/guides');
    await page.getByRole('main').getByRole('link', { name: guides.reviewChecklist.title, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guides.reviewChecklist.title);
    await expect(page.getByRole('region', { name: 'A filled review example' })).toContainText('screen-reader behavior not checked');
    await expect(page.getByRole('main')).toContainText('not accessibility certification or a security audit');
    await page.getByRole('link', { name: 'Use the bug-report template' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guides.bugReport.title);
    const template = page.getByRole('region', { name: 'Write the report' });
    for (const field of ['Expected:', 'Actual:', 'Steps to reproduce:', 'Browser / operating system:', 'Evidence:'])
        await expect(template).toContainText(field);
    await expect(template).toContainText('does not record session replay, console logs or network traffic');
    await expect(page.getByRole('region', { name: 'A filled bug report' })).toContainText('restaurant.example/booking');
    await page.goto(guides.clientReviews.path);
    await expect(page.getByRole('region', { name: 'Agree a review brief' })).toContainText('Out of scope:');
    await expect(page.getByRole('region', { name: 'Plan review rounds and handoff' })).toContainText('confirming one fix does not approve the whole release');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the report template copies only its visible text after an explicit action', async ({ page }) => {
    await page.addInitScript(() => {
        Reflect.set(window, '__guideCopies', [] as string[]);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async (text: string) => { (Reflect.get(window, '__guideCopies') as string[]).push(text); },
            readText: async () => { throw new Error('Guide copy must never read the clipboard'); }
        } });
    });
    await page.goto(guides.bugReport.path);
    expect(await page.evaluate(() => Reflect.get(window, '__guideCopies'))).toEqual([]);
    const region = page.getByRole('region', { name: 'Write the report' });
    const expected = await region.locator('pre').textContent();
    const copy = region.getByRole('button', { name: 'Copy bug report template' });
    await copy.focus();
    await copy.press('Enter');
    await expect(region.getByRole('status')).toHaveText('Copied.');
    expect(await page.evaluate(() => Reflect.get(window, '__guideCopies'))).toEqual([expected]);
});

test('a denied copy selects the checklist for manual copying', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async () => { throw new Error('Clipboard permission denied'); }
    } }));
    await page.goto(guides.reviewChecklist.path);
    const region = page.getByRole('region', { name: 'The checklist' });
    await region.getByRole('button', { name: 'Copy review checklist' }).click();
    await expect(region.getByRole('status')).toContainText('copy it with your browser');
    await expect(region.locator('pre')).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await region.locator('pre').textContent());
});
