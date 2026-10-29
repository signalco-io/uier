import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { expectNoAxeViolations } from './accessibility';
import { showcaseHint, toolbar } from './support/toolbar';

test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${brand.name} · ${brand.tagline}`);
    await expect(page.getByRole('heading', { level: 1, name: brand.tagline })).toBeVisible();
    // Get started opens the app like the navigation's Sign in: sign in, or the app when signed in
    const getStarted = page.getByRole('link', { name: 'Get started' });
    await expect(getStarted.first()).toBeVisible();
    for (const link of await getStarted.all())
        await expect(link).toHaveAttribute('href', '/app');
    await expect(page.getByRole('main').getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how-it-works');
    // Sign in leads into the app: signed-out visitors land on sign in, signed-in people in the app
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/app');
    await expect(page.getByText(new RegExp(`© \\d{4} ${brand.name}`))).toBeVisible();
});

test('landing page sends security headers', async ({ request }) => {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'];
    expect(csp).toContain('default-src \'self\'');
    expect(csp).toContain('frame-ancestors \'none\'');
    expect(response.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers()['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=()');
    expect(response.headers()['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers()['x-xss-protection']).toBe('0');
    expect(csp).not.toMatch(/vercel\.live|vercel\.com|pusher|vitals\.vercel-insights|vercel-scripts/);
});

test('app scripts use a fresh nonce, including the theme script, and reject injected inline scripts', async ({ page, request }) => {
    const violations: string[] = [];
    page.on('console', message => { if (/Content Security Policy|violates.*directive/i.test(message.text())) violations.push(message.text()); });
    const response = await page.goto('/app/sign-in');
    const csp = response!.headers()['content-security-policy']!;
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const scriptPolicy = csp.split(';').find(directive => directive.trim().startsWith('script-src '));
    expect(scriptPolicy).toContain("'strict-dynamic'");
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    expect(response!.headers()['cache-control']).toContain('no-store');
    expect(response!.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeVisible();
    const scripts = await page.locator('script').evaluateAll(nodes => nodes.map(script => ({ nonce: script.nonce, text: script.textContent })));
    expect(scripts.length).toBeGreaterThan(1);
    expect(scripts.filter(script => script.text).every(script => script.nonce === nonce)).toBe(true);
    expect(scripts.some(script => script.text?.includes('localStorage'))).toBe(true);
    const second = await request.get('/app/sign-in', { headers: { 'x-nonce': 'attacker', 'Content-Security-Policy': "script-src 'nonce-attacker'" } });
    expect(second.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
    expect(second.headers()['content-security-policy']).not.toContain('attacker');
    expect(violations).toEqual([]);
    await page.route('**/app/sign-in', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('</body>',
            '<script>window.__uierInjected = true</script></body>') });
    });
    await page.goto('/app/sign-in');
    expect(await page.evaluate(() => '__uierInjected' in window)).toBe(false);
});

test('public and app links load a new document with the destination security policy', async ({ page }) => {
    await page.goto('/');
    const appDocument = page.waitForResponse(response => response.request().isNavigationRequest()
        && new URL(response.url()).pathname === '/app/sign-in');
    await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
    const app = await appDocument;
    expect(app.headers()['content-security-policy']).toContain("'strict-dynamic'");
    expect(app.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    const publicDocument = page.waitForResponse(response => response.request().isNavigationRequest()
        && new URL(response.url()).pathname === '/');
    await page.getByRole('link', { name: 'uier home' }).click();
    const publicPage = await publicDocument;
    expect(publicPage.headers()['cross-origin-opener-policy']).toBe('same-origin');
    expect(publicPage.headers()['content-security-policy']).not.toContain("'strict-dynamic'");
});

test('landing page is accessible (with the showcase toolbar)', async ({ page }) => {
    await page.goto('/');
    await expect(toolbar(page)).toBeVisible();
    await expect(showcaseHint(page)).toBeVisible();
    await expectNoAxeViolations(page);
});

test('toolbar bundle is served at /toolbar.js', async ({ request }) => {
    const response = await request.get('/toolbar.js');
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers['content-type']).toMatch(/^application\/javascript\b/);
    expect(headers['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    expect(headers['access-control-allow-origin']).toBe('*');

    // The production build of packages/toolbar, with its CSS inlined
    const body = await response.text();
    expect(body).toContain('uier-toolbar');
    expect(body).not.toContain('__uier_toolbar_css__');
    expect(body).not.toContain('http://localhost:4004');
});

test('landing page sections are reachable from the navigation', async ({ page }) => {
    await page.goto('/');
    for (const [id, heading] of [
        ['how-it-works', 'How it works'],
        ['features', 'What it does'],
        ['get-started', 'Get started'],
        ['pricing', 'Free, and it stays free'],
        ['faq', 'Questions']
    ] as const) {
        await expect(page.locator(`#${id}`), id).toHaveRole('heading');
        await expect(page.locator(`#${id}`), id).toHaveText(heading);
    }

    const sectionLinks = await page.getByRole('banner').locator('a[href^="/#"]')
        .evaluateAll(links => links.map(link => link.getAttribute('href')));
    expect(sectionLinks).toEqual(['/#how-it-works', '/#features', '/#pricing', '/#faq']);
});

test('pricing states the free offering and nothing else', async ({ page }) => {
    await page.goto('/');
    const pricing = page.getByRole('region', { name: 'Free, and it stays free' });
    await expect(pricing.getByText(brand.pricing)).toBeVisible();
    await expect(pricing.getByRole('heading', { level: 2, name: 'Free, and it stays free' })).toBeVisible();
    await expect(pricing.getByRole('heading', { level: 3, name: 'Included today' })).toBeVisible();
    await expect(pricing.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
    // No invented prices, tiers or trials
    await expect(pricing).not.toContainText(/[$€£]\s?\d|\/\s?mo\b|per month|per year|trial|pro plan|enterprise/i);
});

test('FAQ answers open and close with the keyboard', async ({ page }) => {
    await page.goto('/');
    const faq = page.getByRole('region', { name: 'Questions' });
    const questions = faq.locator('summary');
    await expect(questions).not.toHaveCount(0);

    const ownSite = faq.locator('details').filter({ hasText: 'Can I use uier on my own website?' });
    await ownSite.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(ownSite).toHaveAttribute('open', '');
    await expect(ownSite.getByText(/^Yes\./)).toBeVisible();

    // A link in an open answer is the next stop for Tab
    await page.keyboard.press('Tab');
    await expect(ownSite.getByRole('link', { name: 'uier app' })).toBeFocused();
    await expect(ownSite.getByRole('link', { name: 'uier app' })).toHaveAttribute('href', '/app');

    await ownSite.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(ownSite).not.toHaveAttribute('open');

    const cost = faq.locator('details').filter({ hasText: 'What does it cost?' });
    await cost.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(cost.getByText(brand.pricing)).toBeVisible();

    // Every answer open at once still passes the accessibility checks
    for (const question of await questions.all())
        await question.evaluate(summary => summary.parentElement?.setAttribute('open', ''));
    await expectNoAxeViolations(page);
});
