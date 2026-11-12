import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, showChecksTab, toolbar, openPageCheck } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
let collector: string;
test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
    collector = (await build({ entryPoints: [resolve('../../packages/toolbar/src/checks/lazy/security.ts')], bundle: true, format: 'iife', globalName: 'uierSecurityTest', platform: 'browser', write: false })).outputFiles[0]!.text;
});
test.afterAll(async () => { await site.close(); });
test.use({ actionTimeout: 15_000 });
const section = (panel: Locator, id: string) => panel.locator(`[data-uier-section="security-${id}"]`);
const row = (panel: Locator, id: string) => panel.locator(`[data-uier-check="security-${id}"]`);

async function openPanel(page: Page) {
    if (test.info().project.use.isMobile) {
        await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
        await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^Security and compliance/ }).click();
    } else await openPageCheck(page, /^Security and compliance/);
    const panel = page.getByRole('complementary', { name: 'Security and compliance', exact: true });
    await expect(section(panel, 'snapshot')).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    return panel;
}
async function visit(page: Page, path = 'page') {
    await signIn(page, uniqueEmail('security'));
    const origin = site.origin('fixture-security');
    const project = await createProject(page, { urls: [origin] });
    await page.route('https://cdn.security.example/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '', headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin}/${project}/${path}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return { origin, project, path: `/${project}/${path}` };
}

test('security evidence, explicit anonymous headers, privacy and quick comments share the existing panel controls', async ({ page }) => {
    test.setTimeout(90_000);
    const f = await visit(page);
    const anonymous: { method: string; cookie?: string; authorization?: string; referer?: string }[] = [];
    page.on('request', request => {
        if (request.url().startsWith(`${f.origin}${f.path}`)) anonymous.push({ method: request.method(), ...Object.fromEntries(Object.entries(request.headers()).filter(([key]) => ['cookie', 'authorization', 'referer'].includes(key))) });
    });
    await page.evaluate(() => { document.cookie = 'security_fixture=private-cookie-value-347; path=/'; });
    const panel = await openPanel(page);
    expect(anonymous).toEqual([]);
    await showChecksTab(panel, 'security');
    await expect(row(panel, 'https')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(row(panel, 'sensitive-files')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(row(panel, 'script-integrity')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(row(panel, 'script-integrity')).toContainText('cdn.security.example/lib.js');
    await expect(row(panel, 'script-integrity')).not.toContainText('data.json');
    await expect(panel).not.toContainText('private-script-token-347');
    await expect(panel).not.toContainText('private-cookie-value-347');
    await showChecksTab(panel, 'headers');
    await panel.locator('[data-uier-security-headers]').click();
    await expect(section(panel, 'headers')).toHaveAttribute('data-uier-section-status', 'done');
    expect(anonymous).toEqual([{ method: 'GET' }]);
    await expect(row(panel, 'header-mime')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(row(panel, 'header-hsts')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(row(panel, 'header-frames')).toHaveAttribute('data-uier-check-state', 'pass');
    const referrer = row(panel, 'header-referrer');
    await expect(referrer).toHaveAttribute('data-uier-check-state', 'warn');
    const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${f.project}/comments`);
    await referrer.getByRole('button', { name: 'Comment', exact: true }).click();
    const body = (await sent).postDataJSON();
    expect(body.check).toMatchObject({ type: 'consent', id: 'security-header-referrer' });
    expect(body.text).toContain('fresh anonymous GET');
    expect(body.text).not.toMatch(/private-cookie-value|private-script-token/);
    await expect(referrer).toContainText(/(Comment posted|Bug report sent) as #1/);
    await panel.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(section(panel, 'headers')).toHaveCount(0);
    expect(anonymous).toHaveLength(1);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await animationsFinished(panel);
        await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    }
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('unreadable and redirected anonymous responses are not treated as missing protections', async ({ page }) => {
    test.setTimeout(90_000);
    const f = await visit(page);
    let requests = 0;
    await page.route(`${f.origin}${f.path}`, async route => {
        if (route.request().isNavigationRequest()) return route.continue();
        requests++;
        if (requests === 1) return route.fulfill({ status: 302, headers: { Location: 'https://never-contact.security.example/' } });
        return route.fulfill({ status: 401, contentType: 'text/html', body: 'Sign in' });
    });
    const forbidden: string[] = [];
    page.on('request', request => { if (request.url().includes('never-contact.security.example')) forbidden.push(request.url()); });
    const panel = await openPanel(page);
    await showChecksTab(panel, 'headers');
    for (let i = 0; i < 2; i++) {
        await panel.locator('[data-uier-security-headers]').click();
        await expect(section(panel, 'headers')).toHaveAttribute('data-uier-section-status', 'done');
        await expect(section(panel, 'headers').locator('[data-uier-check-state="none"]')).toHaveCount(5);
        await expect(section(panel, 'headers')).toContainText('Not checked');
    }
    expect(forbidden).toEqual([]);
    expect(requests).toBe(2);
});

test('CSP denial and action-like addresses remain unmeasured without replaying page actions', async ({ page }) => {
    await visit(page, 'blocked');
    const panel = await openPanel(page);
    await showChecksTab(panel, 'headers');
    await panel.locator('[data-uier-security-headers]').click();
    await expect(section(panel, 'headers')).toHaveAttribute('data-uier-section-status', 'done');
    await expect(section(panel, 'headers').locator('[data-uier-check-state="none"]')).toHaveCount(5);
    await expect(section(panel, 'headers')).toContainText('request failed');
    const actions: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/confirm') actions.push(request.url()); });
    await page.evaluate(() => history.replaceState(null, '', '/confirm?token=private-action-token-347'));
    await panel.locator('[data-uier-security-headers]').click();
    await expect(section(panel, 'headers')).toContainText('action or credential-bearing');
    await expect(section(panel, 'headers').locator('[data-uier-check-state="none"]')).toHaveCount(5);
    expect(actions).toEqual([]);
});

test('the header request ignores a fetch the page wrapped; closing the panel aborts it and cannot publish its stale result', async ({ page }) => {
    const f = await visit(page);
    // A page that wraps fetch (to add its credentials, say) does not see the request: it is the toolbar's own
    await page.evaluate(path => {
        const original = window.fetch;
        window.fetch = (input, init) => {
            if (new URL(String(input), location.href).pathname === path) document.documentElement.dataset.wrappedFetch = 'true';
            return original(input, { ...init, credentials: 'include' });
        };
    }, f.path);
    // The response never comes
    const requested = new Promise<void>(resolve => {
        void page.route(`${f.origin}${f.path}`, () => resolve());
    });
    const failed = page.waitForEvent('requestfailed', request => request.url().startsWith(`${f.origin}${f.path}`));
    const panel = await openPanel(page);
    await showChecksTab(panel, 'headers');
    await panel.locator('[data-uier-security-headers]').click();
    await requested;
    await expect(section(panel, 'headers')).toHaveAttribute('data-uier-section-status', 'checking');
    await panel.locator('[data-uier-panel-close]').click();
    await expect(panel).not.toBeVisible();
    await failed;
    await expect(page.locator('html')).not.toHaveAttribute('data-wrapped-fetch');
    const reopened = await openPanel(page);
    await showChecksTab(reopened, 'headers');
    await expect(section(reopened, 'headers')).toHaveCount(0);
    await expect(reopened.locator('[data-uier-security-headers]')).toBeEnabled();
});

test('browser collection distinguishes HTTPS references, optional cookie flags and observed maps without reading secrets or probing paths', async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/*', route => {
        calls.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Security evidence</title></head><body><h1>Security evidence</h1><form action="http://user:private-password@submit.example/path?token=private-token#private"><button>Send</button></form><script src="https://cdn.example/AbCdEfGh12345678/app.js?token=private-token"></script><script src="https://cdn.example/pinned.js" integrity="declared-hash"></script></body></html>' });
    });
    await page.goto('https://security.example.test/page');
    await page.addScriptTag({ content: collector });
    const result = await page.evaluate(async () => {
        Object.defineProperty(window, 'cookieStore', { configurable: true, value: { getAll: async () => [
            { name: 'auth_AbCdEfGh12345678', secure: false, sameSite: 'none', get value() { throw new Error('cookie values must not be read'); } },
            { name: 'no_metadata', get value() { throw new Error('cookie values must not be read'); } }
        ] } });
        const entries = performance.getEntriesByType.bind(performance);
        performance.getEntriesByType = type => type === 'resource' ? [{ name: 'https://cdn.example/app.js.map?token=private-map-token' }] as PerformanceEntry[] : entries(type);
        const api = (window as unknown as { uierSecurityTest: { checkSecurity: (context: { path: string; signal: AbortSignal }) => Promise<unknown> } }).uierSecurityTest;
        const report = await api.checkSecurity({ path: '/page', signal: new AbortController().signal });
        return JSON.parse(JSON.stringify(report, (key, value) => key === 'element' ? undefined : value)) as { checks: { id: string; label: string; state: string }[] };
    });
    expect(result.checks.find((check: { id: string }) => check.id === 'security-https')?.state).toBe('pass');
    expect(result.checks.find((check: { id: string }) => check.id === 'security-mixed-content')?.state).toBe('warn');
    expect(result.checks.find((check: { id: string }) => check.id === 'security-source-maps')?.state).toBe('warn');
    expect(result.checks.find((check: { label: string }) => check.label === 'auth_…')?.state).toBe('warn');
    expect(result.checks.find((check: { label: string }) => check.label === 'no_metadata')?.state).toBe('none');
    expect(JSON.stringify(result)).not.toMatch(/private-password|private-token|private-map-token|AbCdEfGh12345678/);
    expect(calls.some(url => /\.env|\.git|\.map/.test(url))).toBe(false);
});
