import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import { expect, test } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding, selectText } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { pngImage } from './support/images';

for (const colorScheme of ['light', 'dark'] as const) {
    test(`reattach in ${colorScheme}: cancel, element/text confirmation, docking, collapse and reload`, async ({ browser }, testInfo) => {
        const { context, page } = await newVisitor(browser, testInfo);
        await page.emulateMedia({ colorScheme });
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const comment = await page.evaluate(async (screenshot) => {
            const result = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                path: '/', position: { type: 'text', startSelector: '#removed-target', startType: 'text', startOffset: 0, endType: 'text', endOffset: 15, text: 'Original target' },
                quotedText: 'Original target', text: 'Recover this thread', screenshot
            }) });
            return result.json() as Promise<CommentItem>;
        }, pngImage);
        await page.reload();
        const load = () => page.evaluate(async () => (await (await fetch('/api/comments?path=/')).json() as CommentItem[])[0]!);
        await expect(page.locator(`[data-uier-comment="${comment.id}"]`)).toHaveCount(0);
        await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
        const inbox = page.getByRole('complementary', { name: 'Comments' });
        await inbox.getByRole('searchbox', { name: 'Search comments' }).fill('Recover this');
        await expect(inbox.getByText('Target is missing from this page.')).toBeVisible();
        await inbox.getByRole('button', { name: 'Move comments panel' }).focus();
        await page.keyboard.press('ArrowLeft');
        await inbox.getByRole('button', { name: 'Reattach comment', exact: true }).click();
        const panel = page.getByRole('complementary', { name: 'Reattach comment' });
        await expect(panel).toHaveAttribute('data-side', 'left');
        await expect(panel.getByRole('button', { name: 'Confirm anchor' })).toBeDisabled();
        await panel.getByRole('button', { name: 'Choose text', exact: true }).click();
        await selectText(page, 'leaving comments directly');
        await page.getByRole('button', { name: 'Use selected text' }).click();
        await expect(panel.getByRole('button', { name: 'Confirm anchor' })).toBeEnabled();
        await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect((await load()).position).toEqual(comment.position);
        expect((await load()).anchorContext).toBeUndefined();

        await inbox.getByRole('button', { name: 'Reattach comment', exact: true }).click();
        await panel.getByRole('button', { name: 'Choose element', exact: true }).click();
        const target = await page.getByRole('heading', { name: 'Say it on the page.', exact: true }).boundingBox();
        await page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2);
        await expect(panel.getByRole('button', { name: 'Confirm anchor' })).toBeEnabled();
        await panel.getByRole('button', { name: 'Confirm anchor' }).click();
        await expect(inbox.getByText('Anchor matches the saved position.')).toBeVisible();
        const first = await load();
        expect(first.position.type).toBe('point');
        expect(first.anchorContext).toMatchObject({ original: comment.position, previous: comment.position, changes: 1 });
        expect(first.thread).toEqual(comment.thread);
        expect(first.screenshot).toEqual(comment.screenshot);

        await inbox.getByRole('button', { name: 'Reattach comment', exact: true }).click();
        await panel.getByRole('button', { name: 'Choose text', exact: true }).click();
        await selectText(page, 'leaving comments directly');
        await page.getByRole('button', { name: 'Use selected text' }).click();
        await expectNoAxeViolations(page);
        await page.evaluate(() => getSelection()?.removeAllRanges());
        await page.screenshot({ path: testInfo.outputPath(`reattach-${colorScheme}.png`) });
        await panel.getByRole('button', { name: 'Confirm anchor' }).click();
        await expect(inbox.getByText('Anchor changed 2 times')).toBeVisible();
        const second = await load();
        expect(second.position).toMatchObject({ type: 'text', text: 'leaving comments directly' });
        expect(second.anchorContext).toMatchObject({ original: comment.position, previous: first.position, changes: 2 });
        await inbox.getByRole('button', { name: 'Close sidebar' }).click();
        await page.getByRole('button', { name: /Collapse toolbar/ }).click();
        await expect(page.locator('[data-uier-comment]')).toHaveCount(0);
        await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Expand toolbar' }).click();
        await expect(page.locator(`[data-uier-comment="${comment.id}"]`)).toHaveCount(1);
        await page.reload();
        await expect(page.locator(`[data-uier-comment="${comment.id}"]`)).toHaveCount(1);
        expect((await load()).thread).toEqual(comment.thread);
        await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
        await expect(inbox.getByText('Anchor changed 2 times')).toBeVisible();
        await inbox.getByText('Anchor changed 2 times').click();
        await expect(inbox.getByText('Original Text: Original target')).toBeVisible();
        await expect(inbox.locator('blockquote')).toHaveText('Original target');
        // Collapse during an unconfirmed choice cancels it and hides the candidate annotations.
        await inbox.getByRole('button', { name: 'Reattach comment', exact: true }).click();
        await panel.getByRole('button', { name: 'Choose element', exact: true }).click();
        const pageLink = page.getByRole('main').getByRole('link', { name: 'How it works', exact: true });
        await pageLink.focus();
        await page.keyboard.press('Enter');
        await expect(panel.getByRole('button', { name: 'Confirm anchor' })).toBeEnabled();
        await page.getByRole('button', { name: /Collapse toolbar/ }).click();
        await expect(panel).toHaveCount(0);
        await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
        expect((await load()).anchorContext!.changes).toBe(2);
        await page.getByRole('button', { name: 'Expand toolbar' }).click();
        await context.close();
    });
}

test('missing, duplicate, hidden and responsive targets stay searchable without unrelated pins', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.evaluate(async () => {
        for (const [selector, label] of [['#removed', 'Removed element'], ['#responsive', 'Responsive element'], ['#duplicates', 'Duplicate text']]) {
            await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/', text: label,
                position: label === 'Duplicate text' ? { type: 'text', text: 'Unique duplicate phrase', startSelector: selector, startType: 'text', startOffset: 300, endType: 'text', endOffset: 310 }
                    : { type: 'point', selector, xNormal: 0.5, yNormal: 0.5 }
            }) });
        }
    });
    await page.reload();
    await page.evaluate(() => {
        const fixture = document.createElement('section');
        fixture.id = 'duplicates';
        fixture.innerHTML = '<p>Unique duplicate phrase</p><p>Unique duplicate phrase</p><p id="responsive">Responsive target</p>';
        document.querySelector('main')!.prepend(fixture);
        const update = () => { document.getElementById('responsive')!.hidden = window.innerWidth < 900; };
        update(); window.addEventListener('resize', update);
    });
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    const duplicate = inbox.getByRole('article').filter({ hasText: 'Duplicate text' });
    const removed = inbox.getByRole('article').filter({ hasText: 'Removed element' });
    const responsive = inbox.getByRole('article').filter({ hasText: 'Responsive element' });
    await expect(duplicate.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'ambiguous');
    await expect(removed.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'missing');
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(responsive.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'hidden');
    await expect(page.locator('[data-uier-comment]')).toHaveCount(0);
    await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(responsive.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'exact');
    await expect(page.locator('[data-uier-comment]')).toHaveCount(1);
    // Removing one duplicate makes a unique restoration possible. A later duplicate revokes it again.
    await page.locator('#duplicates>p').first().evaluate(el => el.remove());
    await expect(duplicate.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'restored');
    await page.locator('#duplicates').evaluate(el => el.prepend(el.firstElementChild!.cloneNode(true)));
    await expect(duplicate.locator('[data-uier-anchor-state]')).toHaveAttribute('data-uier-anchor-state', 'ambiguous');
    await inbox.getByRole('searchbox').fill('Duplicate text');
    await expect(duplicate).toHaveCount(1);
    await expect(removed).toHaveCount(0);
    await context.close();
});
