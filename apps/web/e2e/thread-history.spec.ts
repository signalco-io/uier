import { expect, test } from '@playwright/test';
import { createProject, inBackground, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

for (const colorScheme of ['light', 'dark'] as const) {
    test(`activity survives reload in app threads and stays out of toolbar threads in ${colorScheme}`, async ({ page, request }) => {
        await page.emulateMedia({ colorScheme });
        const email = uniqueEmail('history');
        const name = email.split('@')[0]!;
        await signIn(page, email);
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Track this checkout fix', authorName: 'Reviewer'
        } });
        expect(response.status()).toBe(201);
        const { id } = await response.json() as { id: string };
        await inBackground(page);
        await page.goto(`/app/projects/${project}`);
        let thread = await openComment(page, 'Track this checkout fix');
        await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeEnabled();
        await thread.getByRole('button', { name: 'Priority: Normal. Change priority', exact: true }).click();
        await page.getByRole('menuitem', { name: 'High', exact: true }).click();
        await expect(thread.getByRole('button', { name: 'Priority: High. Change priority', exact: true })).toBeEnabled();
        await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
        await page.getByRole('menuitem', { name: 'In progress', exact: true }).click();
        await expect(thread.getByRole('button', { name: 'Status: In progress. Change status', exact: true })).toBeVisible();
        await page.reload();
        thread = page.getByRole('article');
        const activity = thread.getByRole('button', { name: /^Activity/ });
        await expect(activity).toHaveAttribute('aria-expanded', 'false');
        await activity.click();
        await animationsFinished(thread);
        const log = thread.getByRole('list', { name: 'Thread activity' });
        await expect(log).toContainText(`${name} assigned ${name}.`);
        await expect(log).toContainText(`${name} changed priority to High.`);
        await expect(log).toContainText(`${name} changed status to In progress.`);
        const lines = await log.getByRole('listitem').allTextContents();
        expect(lines.findIndex(text => text.includes('assigned'))).toBeLessThan(lines.findIndex(text => text.includes('changed priority')));
        expect(lines.findIndex(text => text.includes('changed priority'))).toBeLessThan(lines.findIndex(text => text.includes('changed status')));
        await expect(log.locator('time').first()).toHaveAttribute('datetime', /T/);
        await expectNoAxeViolations(page, { include: ['[role="article"]'] });
        await activity.click();
        await expect(log).toBeHidden();

        await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${id}`);
        const toolbarThread = page.getByRole('article').filter({ hasText: 'Track this checkout fix' });
        // Activity is the app's only (uier #374): the toolbar's thread has no Activity button or log
        await expect(toolbarThread.getByText('Track this checkout fix')).toBeVisible();
        await expect(toolbarThread.getByRole('button', { name: /^Activity/ })).toHaveCount(0);
        await expect(toolbarThread.getByRole('list', { name: 'Thread activity' })).toHaveCount(0);
    });
}
