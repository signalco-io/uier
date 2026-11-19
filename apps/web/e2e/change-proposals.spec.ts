import { expect, test, type Page } from '@playwright/test';
import { commentBubble, selectText, selectionToolbar, toolbar } from './support/toolbar';
import { createProject, projectPublicId, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';

const original = 'Book a table';
const replacement = 'Reserve a table';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.describe.configure({ timeout: 60_000 });
test.use({ actionTimeout: 15_000 });

async function openProposalPage(page: Page) {
    const origin = site.origin('fixture-change-proposals');
    await signIn(page, uniqueEmail('change-proposal'));
    const project = await createProject(page, { urls: [origin], name: 'Change proposal fixture' });
    const code = await projectPublicId(page, project);
    const reviewed = `${origin}/${code}/pricing`;
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(reviewed)}`);
    await expect(toolbar(page).getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    return { origin, endpoint: `/api/review/${code}` };
}

const changeField = (page: Page, property: string) => page.locator(`[data-uier-proposal-input="${property}"]`);
const side = (page: Page, variant: 'original' | 'proposed') => page.locator(`[data-uier-proposal-side="${variant}"]`);

async function expectReadableAboveSheet(page: Page) {
    const sheet = page.locator('[data-uier-proposal-sheet]');
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const target = document.getElementById('proposal-target')!.getBoundingClientRect();
        const backdrop = getComputedStyle(element, '::backdrop');
        return {
            docked: Math.abs(bounds.bottom - innerHeight) <= 2,
            visible: target.top >= 0 && target.bottom <= bounds.top,
            blur: backdrop.backdropFilter,
            tint: backdrop.backgroundColor
        };
    })).toEqual({ docked: true, visible: true, blur: 'none', tint: 'rgba(0, 0, 0, 0)' });
}

test('suggest copy and horizontal padding together, restore the draft, and verify the saved preview', async ({ context, page }, testInfo) => {
    const { origin, endpoint } = await openProposalPage(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const target = page.locator('#proposal-target');
    await toolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
    if (testInfo.project.use.hasTouch) await target.tap();
    else await target.click();
    await expect(page.getByRole('dialog', { name: 'New comment', exact: true })).toBeVisible();
    await page.locator('[data-uier-suggest-change]').click();
    const editor = page.locator('[data-uier-proposal-editor]');
    await expect(editor).toBeVisible();
    if (testInfo.project.use.hasTouch) await expectReadableAboveSheet(page);
    await expect(page.getByText('Suggest a change', { exact: true })).toHaveCount(1);
    await expect(changeField(page, 'text')).toHaveAccessibleName('Replacement text');
    await expect(changeField(page, 'text')).toHaveAccessibleDescription('Original Book a table');
    await expect(changeField(page, 'side-padding')).toHaveValue('8px');
    await expect(editor).toContainText('Original 8px');
    await expect(page.locator('[data-uier-proposal-color="color"]')).toBeAttached();
    await changeField(page, 'text').fill(replacement);
    await changeField(page, 'side-padding').fill('24px');
    await expect(target).toHaveText(replacement);
    await expect(target).toHaveCSS('padding-left', '24px');
    await expect(target).toHaveCSS('padding-right', '24px');
    await expect(target).toHaveCSS('padding-top', '4px');
    if (testInfo.project.use.hasTouch) await expectReadableAboveSheet(page);
    await editor.locator('[data-uier-proposal-padding-details] summary').click();
    await changeField(page, 'padding-right').fill('28px');
    await expect(changeField(page, 'side-padding')).toHaveValue('');
    await expect(target).toHaveCSS('padding-right', '28px');

    await side(page, 'original').click();
    await expect(target).toHaveText(original);
    await expect(target).toHaveCSS('padding-right', '8px');
    await side(page, 'proposed').click();
    await expect(target).toHaveText(replacement);
    if (testInfo.project.use.hasTouch) await expectReadableAboveSheet(page);
    await page.reload();
    await expect(target).toHaveText(original);
    await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await expect(changeField(page, 'text')).toHaveValue(replacement);
    await side(page, 'proposed').click();
    await expect(target).toHaveCSS('padding-right', '28px');

    const posting = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `${endpoint}/comments`);
    await page.getByRole('button', { name: 'Post suggestion', exact: true }).click();
    const payload = (await posting).postDataJSON();
    expect(payload).toMatchObject({
        kind: 'comment',
        position: { type: 'point' },
        proposal: {
            text: { original, proposed: replacement },
            styles: {
                'padding-left': { original: '8px', proposed: '24px' },
                'padding-right': { original: '8px', proposed: '28px' }
            }
        }
    });
    expect(payload.text).toBeUndefined();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread).toBeVisible();
    await expect(side(page, 'original')).toHaveAttribute('aria-pressed', 'true');
    await expect(target).toHaveText(original);
    await side(page, 'proposed').click();
    await expect(target).toHaveText(replacement);
    await thread.locator('[data-uier-proposal-details]').click();
    await thread.locator('[data-uier-proposal-values-side="proposed"]').getByRole('button', { name: /copy.*css/i }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('padding-right: 28px;\npadding-left: 24px;');
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).focus();
    await expect(target).toHaveText(original);
    await side(page, 'proposed').click();
    await expect(target).toHaveText(replacement);
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await expect(target).toHaveText(original);

    await commentBubble(page, 1).click();
    await expect(side(page, 'original')).toHaveAttribute('aria-pressed', 'true');
    await target.evaluate(element => { element.style.paddingLeft = '12px'; });
    await expect(thread.getByRole('status').filter({ hasText: /no longer matches/i })).toBeVisible();
    await expect(side(page, 'proposed')).toBeDisabled();
    await expect(thread.locator('[data-uier-proposal-values-side="proposed"]')).toContainText('padding-left: 24px');
    await expect(target).toHaveCSS('padding-left', '12px');
    await thread.getByRole('button', { name: 'Reattach comment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose element', exact: true })).toBeVisible();
});

test('live-previews typed and AI rewrites and replays a saved legacy rewrite', async ({ page }) => {
    const { endpoint } = await openProposalPage(page);
    const literalSuggestion = 'Reserve a table for **two**';
    await page.route(`**${endpoint}/rewrite`, route => route.fulfill({ json: { suggestions: [literalSuggestion] } }));
    await page.route(`**${endpoint}/comments`, route => {
        if (route.request().method() !== 'POST') return route.continue();
        const { proposal: _proposal, ...legacy } = route.request().postDataJSON();
        return route.continue({ postData: JSON.stringify(legacy) });
    });
    const target = page.locator('#proposal-target');
    await selectText(page, original);
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'New rewrite suggestion', exact: true });
    await editor.getByRole('textbox', { name: 'Suggested text', exact: true }).fill('Find a table');
    await expect(target).toHaveText('Find a table');
    await editor.getByRole('button', { name: 'Suggest', exact: true }).click();
    await editor.getByRole('button', { name: literalSuggestion, exact: true }).click();
    await expect(editor.getByRole('textbox', { name: 'Suggested text', exact: true })).toHaveText(literalSuggestion);
    await expect(target).toHaveText(literalSuggestion);
    await editor.getByRole('button', { name: 'Post suggestion', exact: true }).click();
    await expect(commentBubble(page, 1)).toBeVisible();
    await expect(target).toHaveText(original);
    await side(page, 'proposed').click();
    await expect(target).toHaveText(literalSuggestion);
    await page.evaluate(() => history.pushState(null, '', location.pathname + '?proposal-route'));
    await expect(target).toHaveText(original);
});
