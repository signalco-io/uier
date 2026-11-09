import { expect, test } from '@playwright/test';
import { commentRowLink, commentRows, createProject, hydrated, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// AI thread titles: a thread's row shows the title AI wrote from its first message (the Anthropic stub
// gives one only for a `[stub:title:...]` marker), the open thread shows it above its details with the
// message in full, and a project that turns titles off shows the first line again.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const titled = 'The pay button sits under the footer on my phone [stub:title:Pay button hidden under the footer]';
const plain = 'Footer link is grey';
// Whole row names: the first line holds the marker, so it contains the title's words too
const titleRow = /^Comment #\d+ Pay button hidden under the footer(?: ?, unread)?$/;
const firstLineRow = /^Comment #\d+ The pay button sits under the footer on my phone/;

test('a row shows the title AI wrote for its thread, and the first line once titles are off', async ({ page, request }) => {
    await signIn(page, uniqueEmail('ai-titles'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    for (const text of [titled, plain]) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/checkout`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'bug'
        } });
        expect(response.status()).toBe(201);
    }

    // On by default: the title is made after the comment was saved, and the list shows it once it is there
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(2);
    await expect(async () => {
        await page.reload();
        await expect(commentRowLink(page, titleRow)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // Without a title (the stub gives none) a row keeps the first line
    await expect(commentRowLink(page, plain)).toBeVisible();

    // The thread: the title as its heading, marked as written by AI, and the first message in full
    const thread = await openComment(page, titleRow);
    await expect(thread.getByRole('heading', { name: 'Pay button hidden under the footer', exact: true })).toBeVisible();
    await expect(thread.getByRole('img', { name: 'Title written by AI', exact: true })).toBeVisible();
    await expect(thread).toContainText('The pay button sits under the footer on my phone');

    // A member renames it in place: their title has no AI mark and shows in the row; Escape cancels an edit
    await hydrated(thread);
    await thread.getByRole('button', { name: 'Pay button hidden under the footer', exact: true }).click();
    const field = thread.getByRole('textbox', { name: 'Thread title' });
    await expect(field).toBeFocused();
    await field.fill('Pay button behind the footer');
    await field.press('Enter');
    await expect(thread.getByRole('heading', { name: 'Pay button behind the footer', exact: true })).toBeVisible();
    await expect(thread.getByRole('img', { name: 'Title written by AI', exact: true })).toHaveCount(0);
    // The row has it too (a phone hides the list while a thread is open)
    await expect(page.getByRole('link', { name: /^Comment #\d+ Pay button behind the footer/, includeHidden: true })).toHaveCount(1);
    await thread.getByRole('button', { name: 'Pay button behind the footer', exact: true }).click();
    await field.fill('Something else');
    await field.press('Escape');
    await expect(thread.getByRole('heading', { name: 'Pay button behind the footer', exact: true })).toBeVisible();
    // Cleared (saved on leaving the field): the AI title and its mark are back
    await thread.getByRole('button', { name: 'Pay button behind the footer', exact: true }).click();
    await field.fill('');
    await field.press('Tab');
    await expect(thread.getByRole('heading', { name: 'Pay button hidden under the footer', exact: true })).toBeVisible();
    await expect(thread.getByRole('img', { name: 'Title written by AI', exact: true })).toBeVisible();

    // The workspace has titles on; the project turns them off in its General settings
    await page.goto('/app/workspace/settings');
    await expect(page.getByRole('switch', { name: 'Thread titles' })).toBeChecked();
    await page.goto(`/app/projects/${project}/settings`);
    const general = page.getByRole('region', { name: 'General', exact: true });
    await hydrated(general.locator('form'));
    await general.getByRole('combobox', { name: 'Thread titles' }).click();
    await page.getByRole('option', { name: 'Off', exact: true }).click();
    await general.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(general.getByRole('status')).toContainText('Saved.');
    await expect(general.getByRole('combobox', { name: 'Thread titles' })).toContainText('Off');

    await page.goto(`/app/projects/${project}`);
    await expect(commentRowLink(page, firstLineRow)).toBeVisible();
    await expect(commentRowLink(page, titleRow)).toHaveCount(0);
});
