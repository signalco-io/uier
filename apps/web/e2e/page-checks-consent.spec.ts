import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, showChecksTab, toolbar } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.use({ actionTimeout: 15_000 });
const origin = () => site.origin('fixture-consent');
const section = (panel: Locator, id: string) => panel.locator(`[data-uier-section="consent-${id}"]`);
const named = (panel: Locator, name: string) => panel.locator('[data-uier-check]').filter({ has: panel.page().getByText(name, { exact: true }) });

async function memberReview(page: Page, variant = 'banner') {
    await signIn(page, uniqueEmail('consent'));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/${variant}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

async function openPanel(page: Page) {
    if (test.info().project.use.isMobile) {
        await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
        await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^Consent and cookies/ }).click();
    } else await toolbar(page).getByRole('button', { name: /^Consent and cookies/ }).click();
    const panel = page.getByRole('complementary', { name: 'Consent and cookies' });
    await expect(section(panel, 'snapshot')).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    await showChecksTab(panel, 'snapshot');
    return panel;
}

test('names-only inventory, timing limits, comments and dismissals use the page-checks controls', async ({ page }) => {
    test.setTimeout(90_000);
    const sent: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') sent.push(request.postData() ?? ''); });
    await page.addInitScript(() => {
        if (!location.hostname.startsWith('fixture-consent.')) return;
        document.cookie = '_ga=private-cookie-value-342; path=/; max-age=3600';
        document.cookie = 'unknown_cookie=another-private-value-342; path=/';
        localStorage.setItem('theme', 'private-local-value-342');
        sessionStorage.setItem('tab_state', 'private-session-value-342');
        const read = Storage.prototype.getItem;
        Storage.prototype.getItem = function (name) {
            if (name === 'theme' || name === 'tab_state') throw new Error('The inventory must not read values');
            return read.call(this, name);
        };
    });
    const project = await memberReview(page);
    let panel = await openPanel(page);
    const snapshot = section(panel, 'snapshot');
    await expect(snapshot.locator('[data-uier-check="consent-banner"]')).toContainText('Cookiebot: banner visible');
    await expect(snapshot.locator('[data-uier-check="consent-timing"]')).toContainText('Unknown');
    await expect(named(snapshot, '_ga')).toContainText('Likely analytics');
    await expect(named(snapshot, '_ga')).toContainText('First party (page context)');
    await expect(named(snapshot, 'unknown_cookie')).toContainText('Category unknown');
    await expect(named(snapshot, 'theme')).toContainText('Persistent; application expiry unknown');
    await expect(named(snapshot, 'tab_state')).toContainText('Tab session');
    await expect(panel.locator('[data-uier-consent-limits]')).toContainText('HttpOnly');
    await expect(panel.locator('[data-uier-consent-limits]')).toContainText('server-side');
    for (const value of ['private-cookie-value-342', 'another-private-value-342', 'private-local-value-342', 'private-session-value-342']) {
        await expect(panel).not.toContainText(value);
    }
    await expect(named(snapshot, '_ga')).toHaveAttribute('data-uier-check-state', 'warn');
    await named(snapshot, '_ga').getByRole('button', { name: 'Not an issue' }).click();
    await expect(named(snapshot, '_ga')).toHaveAttribute('data-uier-check-state', 'none');
    await page.reload();
    panel = page.getByRole('complementary', { name: 'Consent and cookies' });
    await expect(section(panel, 'snapshot')).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    const ga = named(section(panel, 'snapshot'), '_ga');
    await expect(ga).toHaveAttribute('data-uier-check-state', 'none');
    await ga.locator('summary[data-uier-dismissed]').click();
    await ga.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(ga).toHaveAttribute('data-uier-check-state', 'warn');
    const next = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
    await ga.getByRole('button', { name: 'Comment', exact: true }).click();
    const body = (await next).postDataJSON();
    expect(body.check).toMatchObject({ type: 'consent', id: expect.stringMatching(/^consent-/) });
    expect(body.position.type).toBe('page');
    expect(body.text).toContain('Set time and prior consent are unknown');
    expect(body.text).toContain('`_ga`');
    await expect(ga).toContainText(/(Comment posted|Bug report sent) as #1/);
    expect(sent.join('\n')).not.toMatch(/private-(cookie|local|session)-value-342|another-private-value-342/);
    await page.reload();
    panel = page.getByRole('complementary', { name: 'Consent and cookies' });
    await expect(named(section(panel, 'snapshot'), '_ga')).toContainText('Reported as #1', { timeout: 20_000 });
    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('before-choice observation distinguishes new storage names and tracker hosts from existing data', async ({ page }) => {
    test.setTimeout(90_000);
    await page.route('https://www.google-analytics.com/**', route => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.addInitScript(() => {
        if (location.hostname.startsWith('fixture-consent.')) document.cookie = 'existing=private-initial-value-342; path=/';
    });
    await memberReview(page);
    const panel = await openPanel(page);
    await showChecksTab(panel, 'before-consent');
    await panel.locator('[data-uier-consent-observe]').click();
    await expect(section(panel, 'observation')).toHaveAttribute('data-uier-section-status', 'checking');
    await page.evaluate(() => {
        setTimeout(() => {
            document.cookie = '_fbp=private-new-cookie-342; path=/';
            document.cookie = 'existing=private-changed-value-342; path=/';
            localStorage.setItem('new_name', 'private-new-local-342');
            void fetch('https://www.google-analytics.com/g/collect?private=private-query-342');
        }, 1500);
    });
    const observation = section(panel, 'observation');
    await expect(observation).toHaveAttribute('data-uier-section-status', 'done', { timeout: 25_000 });
    await expect(named(observation, '_fbp')).toContainText('A new name appeared');
    await expect(named(observation, 'new_name')).toContainText('Local storage');
    await expect(named(observation, 'existing')).toHaveCount(0);
    await expect(named(observation, 'www.google-analytics.com')).toContainText('Third party (known provider)');
    await expect(observation).not.toContainText('private-query-342');
    await expect(observation).not.toContainText('private-new-cookie-342');
    await expect(observation).toContainText('Requests are not proof of storage');
    await panel.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(observation).toHaveCount(0);
    await showChecksTab(panel, 'snapshot');
    await expect(named(section(panel, 'snapshot'), '_fbp')).toContainText('Already present');
});

test('standard cookie attributes stay unknown and blocked storage is reported without values', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
        if (!location.hostname.startsWith('fixture-consent.')) return;
        Object.defineProperty(window, 'cookieStore', { configurable: true, value: { getAll: async () => [{ name: 'standard_cookie', get value() { throw new Error('Values must not be read'); } }] } });
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
    });
    await memberReview(page, 'plain');
    const panel = await openPanel(page);
    await expect(named(section(panel, 'snapshot'), 'standard_cookie')).toContainText('Lifetime unknown');
    await expect(named(section(panel, 'snapshot'), 'standard_cookie')).toContainText('Domain not exposed');
    await expect(section(panel, 'snapshot').locator('[data-uier-check="consent-access"]')).toContainText('Access unavailable: Local storage');
    await expect(section(panel, 'snapshot').locator('[data-uier-check="consent-banner"]')).toContainText('No known marker found');
});

test('exposed cookie metadata is used and a pending observation is cancelled when its panel closes', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
        if (!location.hostname.startsWith('fixture-consent.')) return;
        Object.defineProperty(window, 'cookieStore', { configurable: true, value: { getAll: async () => [
            { name: 'session_cookie', domain: null, expires: null, get value() { throw new Error('Do not read values'); } },
            { name: 'persistent_cookie', domain: `.${location.hostname}`, expires: 1893456000000, get value() { throw new Error('Do not read values'); } }
        ] } });
    });
    await memberReview(page);
    let panel = await openPanel(page);
    await expect(named(section(panel, 'snapshot'), 'session_cookie')).toContainText('Browser session');
    await expect(named(section(panel, 'snapshot'), 'persistent_cookie')).toContainText(new URL(origin()).hostname);
    await expect(named(section(panel, 'snapshot'), 'persistent_cookie')).toContainText('2030-01-01');
    await showChecksTab(panel, 'before-consent');
    await panel.locator('[data-uier-consent-observe]').click();
    await expect(section(panel, 'observation')).toHaveAttribute('data-uier-section-status', 'checking');
    await panel.locator('[data-uier-panel-close]').click();
    await expect(panel).toBeHidden();
    panel = await openPanel(page);
    await showChecksTab(panel, 'before-consent');
    await expect(panel.locator('[data-uier-consent-observe]')).toBeEnabled();
    await expect(section(panel, 'observation')).toHaveCount(0);
});

test('a stalled cookie metadata API falls back to names and inventory bounds remain explicit', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
        if (!location.hostname.startsWith('fixture-consent.')) return;
        document.cookie = '_ga_fallback=private-fallback-value-342; path=/';
        Object.defineProperty(window, 'cookieStore', { configurable: true, value: { getAll: () => new Promise(() => {}) } });
        for (let index = 0; index < 110; index++) sessionStorage.setItem(`bounded_${index}`, 'private-bounded-value-342');
    });
    await memberReview(page);
    const panel = await openPanel(page);
    const snapshot = section(panel, 'snapshot');
    await expect(named(snapshot, '_ga_fallback')).toContainText('Domain not exposed');
    await expect(named(snapshot, '_ga_fallback')).toContainText('Lifetime unknown');
    await expect(snapshot.locator('[data-uier-check="consent-limit"]')).toHaveCount(1);
    expect(await snapshot.locator('[data-uier-check]').filter({ has: page.getByText(/^bounded_\d+$/, { exact: true }) }).count()).toBeLessThanOrEqual(100);
    await expect(panel).not.toContainText('private-fallback-value-342');
    await expect(panel).not.toContainText('private-bounded-value-342');
});
