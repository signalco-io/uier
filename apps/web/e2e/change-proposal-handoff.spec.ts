import { expect, test, type Locator } from '@playwright/test';
import { createProject, enableProjectVerification, openProjectInvite, projectPublicId, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { newVisitor } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;

test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
});

test.afterAll(async () => {
    await site.close();
});

test.setTimeout(60_000);
test.use({ actionTimeout: 10_000 });

test('an invited reviewer opens a change suggestion from the toolbar Copy link', async ({ page, browser, context, baseURL }, testInfo) => {
    const origin = site.origin();
    const touch = Boolean(testInfo.project.use.hasTouch);
    const press = (locator: Locator) => touch ? locator.tap() : locator.click();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await signIn(page, uniqueEmail('proposal-owner'));
    const projectId = await createProject(page, { urls: [origin], name: 'Pricing review' });
    const publicId = await projectPublicId(page, projectId);
    const targetUrl = `${origin}/${publicId}/pricing`;
    await enableProjectVerification(page, projectId);
    await page.goto(`/app/projects/${projectId}`);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email', { exact: true }).fill(uniqueEmail('proposal-reviewer'));
    await invitation.getByRole('button', { name: 'Send invitation', exact: true }).click();
    const invitationUrl = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');

    const reviewer = await newVisitor(browser, testInfo);
    try {
        // Accept in a new account's context. Activation on the main site finishes before the owner posts.
        await reviewer.page.goto(invitationUrl!);
        await reviewer.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
        await reviewer.page.waitForURL(url => url.origin === origin && url.searchParams.get('toolbar-code') === publicId);
        await expect(reviewer.page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();

        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(targetUrl)}`);
        const original = 'Pricing for pricing';
        const proposed = 'Pick the right plan';
        const target = page.getByRole('heading', { level: 1 });
        await expect(target).toHaveText(original);
        await page.getByRole('button', { name: 'Add comment', exact: true }).click();
        const box = (await target.boundingBox())!;
        if (touch) await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
        else await page.mouse.click(box.x + 20, box.y + box.height / 2);
        await page.getByRole('button', { name: 'Suggest a change', exact: true }).click();
        await page.getByRole('textbox', { name: /^Replacement text/ }).fill(proposed);
        // A heading is text: its padding is under More properties
        await page.getByRole('button', { name: 'More properties', exact: true }).click();
        await page.getByRole('textbox', { name: 'Horizontal padding', exact: true }).fill('18px');
        const savedResponse = page.waitForResponse(response => response.request().method() === 'POST'
            && response.url() === `${baseURL}/api/review/${publicId}/comments`);
        await page.getByRole('button', { name: 'Post suggestion', exact: true }).click();
        const response = await savedResponse;
        expect(response.status()).toBe(201);
        const { id, number } = await response.json() as { id: string; number: number };
        await expect(page.getByRole('status').filter({ hasText: 'Suggestion posted' })).toBeVisible();

        const ownerThread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
        if (touch) await expect(ownerThread).toHaveAttribute('data-uier-proposal-sheet', '');
        const copy = ownerThread.getByRole('button', { name: 'Copy', exact: true });
        const copyMenu = page.getByRole('dialog', { name: 'Copy', exact: true });
        const copyIssue = copyMenu.getByRole('button', { name: /^Copy issue/ });
        const copyLink = copyMenu.getByRole('button', { name: /^Copy link/ });
        const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
        const expectedLink = `${targetUrl}?toolbar-code=${publicId}&uier-comment=${id}`;
        await press(copy);
        await press(copyLink);
        await expect(copyMenu).toBeHidden();
        await expect.poll(readClipboard).toBe(expectedLink);
        const link = await readClipboard();

        await press(copy);
        await press(copyIssue);
        await expect(copyMenu).toBeHidden();
        await expect.poll(readClipboard).toContain('## Suggested change');
        const issue = await readClipboard();
        expect(issue).toContain(proposed);
        expect(issue).toContain('padding-left: 18px;');

        await press(copy);
        await expect(copyIssue).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(copyLink).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(copyMenu).toBeHidden();
        await expect(copy).toBeFocused();
        await expect(ownerThread).toBeVisible();

        await press(ownerThread.getByRole('button', { name: 'Status: Open. Change status', exact: true }));
        const statusMenu = page.getByRole('dialog', { name: 'Status', exact: true });
        await press(statusMenu.getByRole('button', { name: 'In progress', exact: true }));
        await expect(statusMenu).toBeHidden();
        await expect(ownerThread.getByRole('button', { name: 'Status: In progress. Change status', exact: true })).toBeVisible();

        const options = ownerThread.getByRole('button', { name: 'Thread options', exact: true });
        await press(options);
        const optionsMenu = page.getByRole('dialog', { name: 'Thread options', exact: true });
        await press(optionsMenu.getByRole('button', { name: 'Request verification', exact: true }));
        await expect(optionsMenu).toBeHidden();
        const verification = ownerThread.getByRole('form', { name: 'Request verification', exact: true });
        await expect(verification.getByRole('textbox', { name: 'Fix summary', exact: true })).toBeFocused();
        await press(verification.getByRole('button', { name: 'Cancel', exact: true }));
        await expect(verification).toBeHidden();
        await expect(options).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(ownerThread).toBeHidden();
        if (touch) await expect(page.getByRole('button', { name: `Comment #${number}, 1 message, In progress`, exact: true })).toBeFocused();

        const linkedSite = reviewer.page.waitForRequest(request => {
            const url = new URL(request.url());
            return request.isNavigationRequest() && url.origin === origin && url.searchParams.get('uier-comment') === id;
        });
        await reviewer.page.goto(link);
        await linkedSite;
        const reviewerThread = reviewer.page.getByRole('dialog', { name: 'Comment thread', exact: true });
        if (touch) await expect(reviewerThread).toHaveAttribute('data-uier-proposal-sheet', '');
        const saved = reviewerThread.getByRole('region', { name: 'Suggested change', exact: true });
        // On a phone the switch is in the sheet's title bar, outside the suggestion
        const originalButton = reviewerThread.getByRole('button', { name: 'Original', exact: true });
        const proposedButton = reviewerThread.getByRole('button', { name: 'Proposed', exact: true });
        await expect(reviewer.page).toHaveURL(`${targetUrl}?toolbar-code=${publicId}`);
        const reviewedHeading = reviewer.page.getByRole('heading', { level: 1 });
        const expectHeading = async (text: string, padding: string) => {
            await expect(reviewedHeading).toHaveText(text);
            await expect(reviewedHeading).toHaveCSS('padding-left', padding);
            await expect(reviewedHeading).toHaveCSS('padding-right', padding);
        };
        await expect(originalButton).toHaveAttribute('aria-pressed', 'true');
        await expectHeading(original, '0px');
        await press(proposedButton);
        await expect(proposedButton).toHaveAttribute('aria-pressed', 'true');
        await expectHeading(proposed, '18px');
        await press(originalButton);
        await expect(originalButton).toHaveAttribute('aria-pressed', 'true');
        await expectHeading(original, '0px');

        await press(saved.getByRole('button', { name: 'Exact values', exact: true }));
        await expect.poll(() => saved.locator('pre').allTextContents()).toEqual([
            original, 'padding-right: 0px;\npadding-left: 0px;',
            proposed, 'padding-right: 18px;\npadding-left: 18px;',
        ]);
    } finally {
        await reviewer.context.close();
    }
});
