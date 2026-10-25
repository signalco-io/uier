import { expect, test, type Page } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail } from './support/app';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function setup(page: Page, label: string) {
    await signIn(page, uniqueEmail('installation'));
    const projectId = await createProject(page, { urls: [site.origin(label)], name: 'Installation check' });
    return { projectId, check: page.getByRole('region', { name: 'Check installation' }) };
}

test('checks the actual project toolbar, API and browser verification, then provides a clean review link', async ({ page }) => {
    const { projectId, check } = await setup(page, 'installed');
    const opened = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Check installation', exact: true }).click();
    const popup = await opened;
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'success');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(popup.getByRole('button', { name: 'Add comment' })).toBeVisible();
    expect(popup.url()).not.toMatch(/uier-token|uier-check/);
    await expect(check.getByRole('link', { name: 'Open checked review' })).toHaveAttribute('href', `${site.origin('installed')}/?toolbar-code=${projectId}`);
    await expect(check.getByRole('button', { name: 'Copy checked review link' })).toBeVisible();
    await expectNoAxeViolations(page);
    await popup.close();
});

for (const [label, message] of [
    ['wrong-project', 'different project'],
    ['wrong-api', 'different uier API'],
    ['blocked-connect', 'connect-src'],
    ['blocked-frame', 'frame-src']
] as const) {
    test(`installation diagnosis: ${label}`, async ({ page }) => {
        const { check } = await setup(page, label);
        const opened = page.waitForEvent('popup');
        await check.getByRole('button', { name: 'Check installation', exact: true }).click();
        const popup = await opened;
        await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'failure');
        await expect(check.getByRole('status', { name: 'Installation result' })).toContainText(message);
        await expect(check.getByRole('button', { name: 'Retry installation check' })).toBeEnabled();
        await popup.close();
    });
}

test('a successful check does not carry over to another selected address', async ({ page }) => {
    await signIn(page, uniqueEmail('two-sites'));
    await createProject(page, { urls: [site.origin('installed'), site.origin('missing-script')] });
    const check = page.getByRole('region', { name: 'Check installation' });
    const opened = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Check installation', exact: true }).click();
    const popup = await opened;
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'success');
    await check.getByRole('combobox', { name: 'Site to check' }).click();
    await page.getByRole('option', { name: site.origin('missing-script'), exact: true }).click();
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveCount(0);
    await expect(check.getByRole('link', { name: 'Open checked review' })).toHaveCount(0);
    await popup.close();
});

test('a failed browser-verification proof cannot confirm the installation', async ({ page, context }) => {
    const { projectId, check } = await setup(page, 'installed');
    await context.route(`**/api/review/${projectId}/verification`, route => route.fulfill({
        status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'bot_detected', message: 'Verification failed' })
    }));
    const opened = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Check installation', exact: true }).click();
    const popup = await opened;
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'failure');
    await expect(check.getByRole('status', { name: 'Installation result' })).toContainText('verification failed');
    await popup.close();
});

for (const label of ['missing-script', 'redirect-denied']) {
    test(`an unconfirmed site stays inconclusive: ${label}`, async ({ page }) => {
        await page.clock.install();
        const { check } = await setup(page, label);
        const opened = page.waitForEvent('popup');
        await check.getByRole('button', { name: 'Check installation', exact: true }).click();
        const popup = await opened;
        await popup.waitForURL(url => url.hostname === (label === 'redirect-denied' ? 'denied.localhost' : `${label}.localhost`));
        await popup.waitForLoadState('domcontentloaded');
        await page.clock.runFor(31_000);
        await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'inconclusive');
        await expect(check.getByRole('status', { name: 'Installation result' })).toContainText('No complete confirmation');
        await expect(check.getByRole('link', { name: 'Open checked review' })).toHaveCount(0);
        await popup.close();
    });
}

test('cancel, a closed window and forged messages cannot confirm an installation', async ({ page }) => {
    const { projectId, check } = await setup(page, 'missing-script');
    const opened = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Check installation', exact: true }).click();
    const popup = await opened;
    await popup.waitForURL(url => url.hostname === 'missing-script.localhost');
    const nonce = new URL(popup.url()).searchParams.get('uier-check');
    await page.evaluate(({ origin, projectId, nonce }) => {
        window.dispatchEvent(new MessageEvent('message', { origin, source: window,
            data: { type: 'uier:installation', nonce, project: projectId, apiOrigin: location.origin, stage: 'ready' } }));
    }, { origin: site.origin('missing-script'), projectId, nonce });
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'checking');
    await check.getByRole('button', { name: 'Cancel check' }).click();
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'inconclusive');
    await expect(check.getByRole('status', { name: 'Installation result' })).toContainText('canceled');
    const retry = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Retry installation check' }).click();
    const retried = await retry;
    await retried.waitForURL(url => url.hostname === 'missing-script.localhost');
    await retried.close();
    await page.bringToFront();
    await expect(check.getByRole('status', { name: 'Installation result' })).toContainText('closed or disconnected');
});
