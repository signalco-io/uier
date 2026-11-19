import { expect, test } from '@playwright/test';
import { createProject, projectPublicId, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { commentBubble, toolbar } from './support/toolbar';

test('a saved CSS-only suggestion keeps Exact values when its positional target changes', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        const origin = site.origin('fixture-change-proposals');
        await signIn(page, uniqueEmail('proposal-target-identity'));
        const project = await createProject(page, { urls: [origin], name: 'Proposal target identity' });
        const code = await projectPublicId(page, project);
        await page.addInitScript(() => {
            if (!location.pathname.endsWith('/pricing')) return;
            document.addEventListener('DOMContentLoaded', () => {
                const list = document.createElement('ul');
                list.id = 'proposal-labels';
                list.style.color = 'navy';
                const labels = sessionStorage.getItem('reorder-proposal-fixture')
                    ? ['Second label', 'First label'] : ['First label', 'Second label'];
                for (const text of labels) {
                    const label = document.createElement('li');
                    label.textContent = text;
                    list.append(label);
                }
                document.querySelector('main')!.prepend(list);
            });
        });
        const reviewed = `${origin}/${code}/pricing`;
        await page.goto(`/app/review/${project}?url=${encodeURIComponent(reviewed)}`);
        const list = page.locator('#proposal-labels');
        const first = list.getByText('First label', { exact: true });
        const second = list.getByText('Second label', { exact: true });
        const proposed = page.locator('[data-uier-proposal-side="proposed"]');
        await toolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
        if (testInfo.project.use.hasTouch) await first.tap();
        else await first.click();
        await page.locator('[data-uier-suggest-change]').click();
        await page.locator('[data-uier-proposal-input="color"]').fill('#ff0000');
        await expect(first).toHaveCSS('color', 'rgb(255, 0, 0)');
        await expect(second).toHaveCSS('color', 'rgb(0, 0, 128)');

        const response = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === `/api/review/${code}/comments`);
        await page.getByRole('button', { name: 'Post suggestion', exact: true }).click();
        const posted = await response;
        expect(posted.ok()).toBe(true);
        const payload = posted.request().postDataJSON();
        expect(payload.position).toMatchObject({ selector: '#proposal-labels>li:nth-of-type(1)', proposalLabelHash: /^v1-[0-9a-f]{16}$/ });
        expect(payload.proposal).toEqual({ styles: { color: { original: 'rgb(0, 0, 128)', proposed: '#ff0000' } } });
        expect(JSON.stringify(payload.position)).not.toContain('First label');

        const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
        await expect(thread).toBeVisible();
        await proposed.click();
        await expect(first).toHaveCSS('color', 'rgb(255, 0, 0)');
        await list.evaluate(element => {
            element.prepend(element.lastElementChild!);
            sessionStorage.setItem('reorder-proposal-fixture', '1');
        });
        await expect(first).toHaveCSS('color', 'rgb(0, 0, 128)');
        await expect(second).toHaveCSS('color', 'rgb(0, 0, 128)');
        await expect(proposed).toBeDisabled();

        await page.reload();
        await expect(list.locator('li').first()).toHaveText('Second label');
        await commentBubble(page, 1).click();
        await expect(proposed).toBeDisabled();
        await expect(thread.getByRole('status').filter({ hasText: /no longer matches/i })).toBeVisible();
        const details = thread.getByRole('button', { name: 'Exact values', exact: true });
        await expect(details).toBeVisible();
        if (await details.getAttribute('aria-expanded') !== 'true') await details.click();
        await expect(thread.locator('[data-uier-proposal-values-side="proposed"]')).toContainText('color: #ff0000;');
        await expect(first).toHaveCSS('color', 'rgb(0, 0, 128)');
        await expect(second).toHaveCSS('color', 'rgb(0, 0, 128)');

        for (const removeSuggestion of [false, true]) {
            await page.keyboard.press('Escape');
            await expect(thread).toBeHidden();
            await toolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
            const position = { x: removeSuggestion ? 16 : 64, y: 8 };
            if (testInfo.project.use.hasTouch) await first.tap({ position });
            else await first.click({ position });
            if (removeSuggestion) {
                await page.locator('[data-uier-suggest-change]').click();
                await page.locator('[data-uier-proposal-input="color"]').fill('#ff0000');
                await expect(first).toHaveCSS('color', 'rgb(255, 0, 0)');
                await page.getByRole('button', { name: 'Remove suggestion', exact: true }).click();
                await expect(first).toHaveCSS('color', 'rgb(0, 0, 128)');
            }
            await page.getByRole('textbox', { name: 'Comment', exact: true }).fill(removeSuggestion ? 'Note after removing the suggestion' : 'Ordinary note');
            const response = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname === `/api/review/${code}/comments`);
            await page.getByRole('button', { name: 'Post comment', exact: true }).click();
            const posted = await response;
            expect(posted.ok()).toBe(true);
            const payload = posted.request().postDataJSON();
            expect(payload.position).toMatchObject({ type: 'point', selector: '#proposal-labels>li:nth-of-type(2)' });
            expect(payload.position).not.toHaveProperty('proposalLabelHash');
            expect(payload).not.toHaveProperty('proposal');
            await expect(thread).toBeVisible();
        }
    } finally {
        await site.close();
    }
});
