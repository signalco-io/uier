import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail } from './support/app';
import { commentBubble, openThread } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

test('selected mentions recover with their draft and an unchanged lost-response retry posts once', async ({ page }) => {
    const email = uniqueEmail('mention-retry');
    const name = email.split('@')[0]!;
    await signIn(page, email);
    const projectId = await createProject(page, { urls: [site.origin()] });
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}/${projectId}/pricing`)}`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Please review @');
    await page.getByRole('listbox', { name: 'Mention people' }).getByRole('option').first().click();
    const text = `Please review @${name} `;
    await expect(composer).toHaveValue(text);
    let drop = true;
    let originalId = '';
    await page.route(`**/api/review/${projectId}/comments`, async route => {
        if (drop && route.request().method() === 'POST') {
            drop = false;
            const saved = await route.fetch();
            expect(saved.status()).toBe(201);
            originalId = (await saved.json() as { id: string }).id;
            await route.abort('failed');
        } else await route.continue();
    });
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Check your connection');
    await expect(composer).toHaveValue(text);
    await page.reload();
    const recovered = page.locator('[data-uier-comment="new"]');
    await expect(recovered).toBeVisible();
    await recovered.click();
    await expect(composer).toHaveValue(text);
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/review/${projectId}/comments`);
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    const saved = await (await response).json() as { id: string; thread: { items: { mentions?: { userId: string; name: string }[] }[] } };
    expect(saved.id).toBe(originalId);
    expect(saved.thread.items[0]!.mentions).toEqual([expect.objectContaining({ userId: expect.stringMatching(/^u_/), name })]);
    await expect(commentBubble(page, 1)).toBeVisible();
    await expect(openThread(page)).toContainText(`Please review @${name}`);
    await page.reload();
    await expect(page.locator('[data-uier-comment]')).toHaveCount(1);
});
