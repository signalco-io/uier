import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import {
    commentBubble,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    selectText,
    selectionToolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Rewrite suggestions for selected text: the reviewer's own text, or one of the AI suggestions.
// The e2e server has no Anthropic API key, so the suggestions are mocked here; without the mock
// the real endpoint answers 503 ("not available").

const selected = 'Review any live website by leaving comments directly on it.';

test('rewrite: pick a suggestion and post it', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    const requests: unknown[] = [];
    await page.route('**/api/rewrite', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
            json: {
                suggestions: [
                    'Review any live site by commenting right on it.',
                    'Comment on any live website, right on the page.',
                    'Leave comments directly on any live website.'
                ]
            }
        });
    });
    await openLanding(page, origin, { dismissHint: true });
    expect(brand.description).toContain(selected);

    await selectText(page, selected);
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click();
    const draft = page.getByRole('dialog', { name: 'New rewrite suggestion' });
    // The reviewer's own version starts as the selected text
    const suggested = draft.getByRole('textbox', { name: 'Suggested text' });
    await expect(suggested).toBeFocused();
    await expect(suggested).toHaveValue(selected);
    await expect(draft.locator('blockquote')).toHaveText(selected);

    // Suggestions, optionally with an instruction
    await draft.getByRole('textbox', { name: 'Instruction for suggestions' }).fill('Shorter');
    await draft.getByRole('button', { name: 'Suggest', exact: true }).click();
    const suggestions = draft.getByRole('group', { name: 'Suggestions' });
    await expect(suggestions.getByRole('button')).toHaveCount(3);
    expect(requests).toEqual([{ text: selected, instruction: 'Shorter' }]);
    await expect(page.getByRole('status').filter({ hasText: '3 suggestions' })).toBeAttached();
    await expectNoAxeViolations(page);

    // A picked suggestion becomes the text, to post as it is or to edit
    await suggestions.getByRole('button', { name: 'Comment on any live website, right on the page.' }).click();
    await expect(suggested).toHaveValue('Comment on any live website, right on the page.');
    await suggested.press('End');
    await suggested.pressSequentially(' Nothing to install.');
    await draft.getByRole('button', { name: 'Post suggestion' }).click();

    // Saved as a rewrite suggestion of the selected text, its thread opens
    const thread = openThread(page);
    await expect(commentBubble(page, 1)).toBeVisible();
    await expect(thread.getByText('Suggested rewrite', { exact: true })).toBeVisible();
    await expect(thread.locator('blockquote')).toHaveText(selected);
    await expect(thread.getByText('Comment on any live website, right on the page. Nothing to install.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Suggestion posted' })).toBeAttached();
    const [saved] = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as { kind: string; position: { type: string; text: string }; thread: { items: { text: string; quotedText?: string }[] } }[]);
    expect(saved).toMatchObject({
        kind: 'rewrite',
        position: { type: 'text', text: selected },
        thread: { items: [{ text: 'Comment on any live website, right on the page. Nothing to install.', quotedText: selected }] }
    });

    await context.close();
});

test('rewrite: without suggestions the reviewer writes their own', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    await selectText(page, selected);
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click();
    const draft = page.getByRole('dialog', { name: 'New rewrite suggestion' });
    // The real endpoint: no API key on the e2e server
    await draft.getByRole('button', { name: 'Suggest', exact: true }).click();
    await expect(draft.getByRole('alert')).toHaveText('Suggestions are not available right now. You can still write your own.');

    const suggested = draft.getByRole('textbox', { name: 'Suggested text' });
    await suggested.fill('Review a live website right on its pages.');
    await suggested.press('Enter');
    await expect(openThread(page).getByText('Suggested rewrite', { exact: true })).toBeVisible();
    await expect(openThread(page).getByText('Review a live website right on its pages.')).toBeVisible();

    // Closing an unchanged rewrite leaves nothing behind
    await page.keyboard.press('Escape');
    await selectText(page, selected);
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click();
    await expect(draft).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(draft).toBeHidden();
    await expect(page.getByRole('button', { name: 'New rewrite suggestion' })).toHaveCount(0);

    await context.close();
});
