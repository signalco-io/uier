import { expect, test, type Page } from '@playwright/test';
import { commentRows, createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// A project's comments show by priority (Urgent, High, Normal, Low), then by number, highest first:
// in the list and in each board column, and a thread moves as soon as its priority changes.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const selected = (page: Page, number: number) => page.getByRole('checkbox', { name: `Select comment #${number}`, exact: true });

/** Sets one thread's priority with the selection's Prioritize selected */
async function prioritize(page: Page, number: number, priority: 'Urgent' | 'High' | 'Low') {
    await selected(page, number).check();
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: priority, exact: true }).click();
    await expect(selected(page, number)).toBeEnabled();
    await expect(selected(page, number)).not.toBeChecked();
}

test('the list and board columns show threads by priority, then by number', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The order is the same on every screen');
    await signIn(page, uniqueEmail('comment-order'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const numbers: number[] = [];
    for (let index = 1; index <= 4; index++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `Order thread ${index}`, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers.push((await response.json() as { number: number }).number);
    }
    await page.goto(`/app/projects/${project}`);
    // All Normal: by number, highest first
    await expect(commentRows(page)).toHaveText([/Order thread 4/, /Order thread 3/, /Order thread 2/, /Order thread 1/]);

    // A new priority moves the thread at once
    await prioritize(page, numbers[2]!, 'Urgent');
    await expect(commentRows(page)).toHaveText([/Order thread 3/, /Order thread 4/, /Order thread 2/, /Order thread 1/]);
    await prioritize(page, numbers[0]!, 'Low');
    await prioritize(page, numbers[3]!, 'High');
    const order = [/Order thread 3/, /Order thread 4/, /Order thread 2/, /Order thread 1/];
    await expect(commentRows(page)).toHaveText(order);
    await page.reload();
    await expect(commentRows(page)).toHaveText(order);

    // The board column, in the same order
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveText(order);
});
