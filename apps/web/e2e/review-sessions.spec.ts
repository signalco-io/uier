import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, openThread, toolbar } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;

test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
});

test.afterAll(async () => {
    await site.close();
});

async function draftComment(page: Page, text: string, target = page.getByRole('heading', { level: 1 })) {
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    await target.click({ position: { x: 20, y: 10 } });
    await page.getByRole('textbox', { name: 'Comment', exact: true }).fill(text);
}

async function reviewedProject(page: Page) {
    await signIn(page, uniqueEmail('review-session'));
    const origin = site.origin();
    const id = await createProject(page, { urls: [origin], name: 'Review sessions' });
    await page.goto(`/app/review/${id}?url=${encodeURIComponent(`${origin}/${id}/pricing`)}`);
    await expect(toolbar(page)).toBeVisible();
}

function reviewPin(page: Page, number: number) {
    return page.getByRole('button', { name: new RegExp(`^Comment #${number},`) });
}

test('collects, reloads, sends and resumes a review in the toolbar', async ({ page }) => {
    await reviewedProject(page);
    const marker = page.locator('[data-uier-review-marker]');
    const session = page.getByRole('dialog', { name: 'Review session', exact: true });

    await draftComment(page, 'Check the yearly price.');
    await page.getByRole('button', { name: 'Start review with this comment', exact: true }).click();
    await expect(reviewPin(page, 1)).toHaveAccessibleDescription(/Not sent/);
    await expect(openThread(page).getByText('Not sent', { exact: true })).toBeVisible();

    await page.reload();
    await expect(marker).toHaveText('1 unsent comment');
    await marker.click();
    await expect(session.getByRole('button', { name: /Check the yearly price/ })).toBeVisible();
    await session.getByRole('button', { name: /Check the yearly price/ }).click();
    await expect(openThread(page).getByRole('group', { name: 'Messages' }).getByText('Check the yearly price.')).toBeVisible();
    await marker.click();
    await session.getByRole('textbox', { name: 'Title (optional)' }).fill('Pricing review');
    await session.getByRole('textbox', { name: 'Summary (optional)' }).fill('Check the new pricing page.');
    await expect(page.getByRole('dialog', { name: 'Comment thread', exact: true })).toHaveCount(0);
    await animationsFinished(session);
    await expectNoAxeViolations(page);
    await session.getByRole('button', { name: 'Send review', exact: true }).click();
    await expect(marker).toHaveCount(0);
    await expect(reviewPin(page, 1)).not.toHaveAccessibleDescription(/Not sent/);

    // The review number and its resume action come from the saved thread.
    await page.reload();
    await reviewPin(page, 1).click();
    await expect(openThread(page).getByText('Review 1', { exact: true })).toBeVisible();
    await openThread(page).getByRole('button', { name: 'Resume session' }).click();
    await expect(marker).toHaveText('0 unsent comments');
    await draftComment(page, 'Check the monthly price too.', page.getByText('A page on a site under review.', { exact: false }));
    await page.getByRole('button', { name: 'Add to session', exact: true }).click();
    await expect(reviewPin(page, 2)).toHaveAccessibleDescription(/Not sent/);
    await marker.click();
    await expect(session.getByRole('heading', { name: 'Review 1' })).toBeVisible();
    await session.getByRole('button', { name: 'Send review', exact: true }).click();
    await expect(marker).toHaveCount(0);
    await expect(reviewPin(page, 2)).not.toHaveAccessibleDescription(/Not sent/);
});

test('confirms discard from options without sending the comment', async ({ page }) => {
    await reviewedProject(page);
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Start review session', exact: true }).click();
    await draftComment(page, 'A comment to discard.');
    await page.getByRole('button', { name: 'Add to session', exact: true }).click();
    const marker = page.locator('[data-uier-review-marker]');
    await expect(marker).toHaveText('1 unsent comment');
    await marker.click();
    const session = page.getByRole('dialog', { name: 'Review session', exact: true });
    await session.getByRole('button', { name: 'Discard unsent comments' }).click();
    await expect(session.getByText('Discard 1 comment and its replies?')).toBeVisible();
    await session.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(session.getByRole('button', { name: 'Send review', exact: true })).toBeEnabled();
    await session.getByRole('button', { name: 'Discard unsent comments' }).click();
    await session.getByRole('button', { name: 'Discard unsent comments' }).click();
    await expect(marker).toHaveCount(0);
    await expect(reviewPin(page, 1)).toHaveCount(0);
});

test('keeps the next comment while a full review is sent', async ({ page }) => {
    await reviewedProject(page);
    await draftComment(page, 'First review comment.');
    await page.getByRole('button', { name: 'Start review with this comment', exact: true }).click();
    const marker = page.locator('[data-uier-review-marker]');
    await expect(marker).toHaveText('1 unsent comment');
    // The API suite exercises the actual 100-comment cap. Use the same visible state here
    // without sending 100 browser comments or spending the project's posting allowance.
    const viewer = /\/api\/review\/[a-zA-Z0-9_-]+$/;
    await page.route(viewer, async route => {
        const response = await route.fetch();
        const body = await response.json();
        if (body.reviewSession) body.reviewSession.threadCount = 100;
        await route.fulfill({ response, json: body });
    });
    await page.reload();
    await expect(marker).toBeVisible();
    await draftComment(page, 'Keep this for the next review.', page.getByText('A page on a site under review.', { exact: false }));
    await expect(page.getByRole('button', { name: 'Add to session', exact: true })).toBeDisabled();
    await expect(page.getByText('This review has 100 comments. Send it to start another review.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(reviewPin(page, 2)).toHaveCount(0);
    await page.unroute(viewer);
    await marker.click();
    await page.getByRole('button', { name: 'Send review', exact: true }).click();
    await expect(marker).toHaveCount(0);
    const start = page.getByRole('button', { name: 'Start review with this comment', exact: true });
    if (!await start.isVisible()) await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Keep this for the next review.');
    await start.click();
    await expect(marker).toHaveText('1 unsent comment');
    await expect(reviewPin(page, 2)).toHaveAccessibleDescription(/Not sent/);
});

test('retries a lost comment response in its original review after the review was sent', async ({ page }) => {
    await reviewedProject(page);
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Start review session', exact: true }).click();
    let reachedServer = false;
    await page.route(/\/api\/review\/[^/]+\/comments$/, async route => {
        if (route.request().method() !== 'POST' || reachedServer) return route.continue();
        const response = await route.fetch();
        reachedServer = response.ok();
        await route.abort('failed');
    });
    await draftComment(page, 'Keep this submission once.');
    await page.getByRole('button', { name: 'Add to session', exact: true }).click();
    await expect.poll(() => reachedServer).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Keep this submission once.');

    await page.reload();
    const marker = page.locator('[data-uier-review-marker]');
    await expect(marker).toHaveText('1 unsent comment');
    await marker.click();
    await page.getByRole('button', { name: 'Send review', exact: true }).click();
    await expect(marker).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(page.locator('[data-uier-draft]')).toHaveCount(0);
    await expect(reviewPin(page, 1)).toBeVisible();
    await expect(reviewPin(page, 2)).toHaveCount(0);
});
