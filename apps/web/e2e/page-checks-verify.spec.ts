import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { animationsFinished, commentBubble, openThread, threadOptions, toolbar } from './support/toolbar';

// A comment posted from a page check runs that check again in its thread, on the page it was posted
// on (packages/toolbar/docs/page-checks-verify.md). The page is `fixtures/verify.ts`: an image
// without alt text, a script link and no meta description; `?fixed` fixes all three.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-verify');

/** A member reviews the fixture's page through the app's review link */
async function memberReview(page: Page, project: string) {
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/pricing`)}`);
    await expect(toolbar(page)).toBeVisible();
}

test('a finding posted from a panel is checked again in its thread: still found, then no longer found once fixed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('verify-panel'));
    const project = await createProject(page, { urls: [origin()] });
    await memberReview(page, project);

    // The Accessibility panel posts the image's finding, the SEO panel the link's
    await toolbar(page).getByRole('button', { name: /^Accessibility/ }).click();
    const accessibility = page.getByRole('complementary', { name: 'Accessibility' });
    await expect(accessibility.getByRole('button', { name: 'Close Accessibility panel' })).toBeFocused();
    const image = accessibility.locator('[data-uier-rule="image-alt"]').getByRole('listitem').filter({ hasText: 'img#verify-chart' });
    await image.getByRole('button', { name: 'Comment' }).click();
    await expect(image).toContainText(/Comment posted as #1/);
    await page.keyboard.press('Escape');
    await expect(accessibility).toBeHidden();
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const seo = page.getByRole('complementary', { name: 'SEO' });
    await expect(seo.getByRole('button', { name: 'Close SEO panel' })).toBeFocused();
    const link = seo.locator('[data-uier-check="link-address"]');
    await link.getByRole('button', { name: 'Comment' }).click();
    await expect(link).toContainText(/Comment posted as #2/);
    await page.keyboard.press('Escape');
    await expect(seo).toBeHidden();

    // The image's thread names its check; Check again runs it on the image: still there
    await commentBubble(page, 1, 1).click();
    let thread = openThread(page);
    let recheck = thread.locator('[data-uier-recheck]');
    await expect(recheck).toHaveText(/^Accessibility check: image-alt\s*Check again$/);
    await thread.getByRole('button', { name: 'Check again' }).click();
    await expect(recheck).toHaveAttribute('data-uier-recheck', 'warn');
    await expect(recheck.getByRole('status')).toHaveText(/^Still found on this page\. Element does not have an alt attribute\.$/);

    // Fixed on the page: no longer found, and the thread is still open (the reviewer decides)
    await page.evaluate(() => document.getElementById('verify-chart')?.setAttribute('alt', 'Plan comparison chart'));
    await thread.getByRole('button', { name: 'Check again' }).click();
    await expect(recheck).toHaveAttribute('data-uier-recheck', 'pass');
    await expect(recheck.getByRole('status')).toHaveText('No longer found on this page.');
    await expect(thread.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeVisible();
    await animationsFinished(thread);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    await page.keyboard.press('Escape');

    // The link's thread: the SEO panel's own check, on the link
    await commentBubble(page, 1, 2).click();
    thread = openThread(page);
    recheck = thread.locator('[data-uier-recheck]');
    await thread.getByRole('button', { name: 'Check again' }).click();
    await expect(recheck.getByRole('status')).toHaveText('Still found on this page. It runs a script instead of opening a page.');
    await page.evaluate(() => document.getElementById('verify-link')?.setAttribute('href', '/plans'));
    await thread.getByRole('button', { name: 'Check again' }).click();
    await expect(recheck.getByRole('status')).toHaveText('No longer found on this page.');
});

test('a Ready to verify thread checks its finding when it opens; a check that cannot run here shows nothing', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('verify-ready'));
    const project = await createProject(page, { urls: [origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    // A guest posted the findings (with their checks, as the panels do), so a member can ask them to verify
    const headers = await verifiedReviewHeaders(request, project, origin());
    const path = `/${project}/pricing`;
    const post = async (data: Record<string, unknown>) => {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: { path, authorName: 'Guest reviewer', ...data } });
        expect(response.status()).toBe(201);
    };
    await post({ text: 'Accessibility (critical): Images must have alternative text.', check: { type: 'accessibility', id: 'image-alt' },
        position: { type: 'point', selector: '#verify-chart', xNormal: 0.5, yNormal: 0.5 } });
    await post({ text: 'SEO: The page has no meta description.', check: { type: 'seo', id: 'description' }, position: { type: 'page' }, kind: 'feedback' });
    await post({ text: 'Accessibility: our own rule about this link.', check: { type: 'accessibility', id: 'custom' },
        position: { type: 'point', selector: '#verify-link', xNormal: 0.5, yNormal: 0.5 } });
    await memberReview(page, project);

    // A rule this toolbar cannot run (a custom one) shows nothing
    await commentBubble(page, 1, 3).click();
    let thread = openThread(page);
    await expect(thread).toContainText('our own rule about this link');
    await expect(thread.locator('[data-uier-recheck]')).toHaveCount(0);
    await expect(thread.getByRole('button', { name: 'Check again' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Page feedback in the inbox, checked when asked: still no meta description
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    let card = inbox.getByRole('article').filter({ hasText: 'The page has no meta description.' });
    await expect(card.locator('[data-uier-recheck]')).toContainText('SEO check: description');
    await card.getByRole('button', { name: 'Check again' }).click();
    await expect(card.locator('[data-uier-recheck]').getByRole('status')).toHaveText(/^Still found on this page\. No meta description\./);
    await page.keyboard.press('Escape');
    await expect(inbox).toBeHidden();

    // The image's thread asked to verify: it checks the finding on its own, between the request and the answers
    await commentBubble(page, 1, 1).click();
    thread = openThread(page);
    await expect(thread.locator('[data-uier-recheck]')).toHaveAttribute('data-uier-recheck', 'idle');
    await (await threadOptions(page, thread)).getByRole('button', { name: 'Request verification', exact: true }).click();
    const form = thread.getByRole('form', { name: 'Request verification' });
    await form.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Added the alt text');
    await form.getByRole('button', { name: 'Request verification', exact: true }).click();
    const ready = thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true });
    await expect(ready).toBeVisible();
    const evidence = thread.getByRole('region', { name: 'Fix verification' }).locator('[data-uier-recheck]');
    await expect(evidence).toHaveAttribute('data-uier-recheck', 'warn');
    await expect(evidence.getByRole('status')).toHaveText(/^Still found on this page\./);
    await page.keyboard.press('Escape');

    // The fixed page (the same page, the same comments): opening the thread checks it, without a click
    await page.goto(`${origin()}${path}?fixed`);
    await expect(toolbar(page)).toBeVisible();
    await commentBubble(page, 1, 1).click();
    thread = openThread(page);
    const fixed = thread.getByRole('region', { name: 'Fix verification' }).locator('[data-uier-recheck]');
    await expect(fixed).toHaveAttribute('data-uier-recheck', 'pass');
    await expect(fixed.getByRole('status')).toHaveText('No longer found on this page.');
    // Evidence only: it is still the reviewer's to confirm
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await animationsFinished(thread);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    await thread.screenshot({ path: testInfo.outputPath('verify-ready-thread.png') });
    await page.keyboard.press('Escape');

    // The page feedback, on the fixed page: no longer found
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    card = inbox.getByRole('article').filter({ hasText: 'The page has no meta description.' });
    await card.getByRole('button', { name: 'Check again' }).click();
    await expect(card.locator('[data-uier-recheck]').getByRole('status')).toHaveText('No longer found on this page.');
});
