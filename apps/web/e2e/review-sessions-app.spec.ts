import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { commentRows, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';

test('groups an open review in the app, sends as an admin and filters by the published review', async ({ page, request }) => {
    const origin = 'https://reviewed.example';
    await signIn(page, uniqueEmail('review-session-app'));
    const project = await createProject(page, { name: 'Session triage', urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, origin);
    const api = `/api/review/${project}`;
    const started = await request.post(`${api}/review-sessions`, { headers });
    expect(started.ok()).toBeTruthy();
    const { id, draftId } = await started.json() as { id: string; draftId: string };
    for (const [index, text] of ['Ordinary feedback', 'Review feedback'].entries()) {
        const response = await request.post(`${api}/comments`, { headers, data: {
            text, path: '/plans', position: { type: 'page' }, kind: 'feedback', authorName: 'Ana',
            idempotencyKey: randomUUID(), ...(index ? { reviewSessionId: id, reviewDraftId: draftId } : {})
        } });
        expect(response.status()).toBe(201);
    }
    await page.goto(`/app/projects/${project}?view=list&status=all`);
    await hydrated(page.getByRole('button', { name: 'List', exact: true }));
    const rows = commentRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Review feedback' }).getByText('Not sent', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Group by' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Review session' }).click();
    const group = page.locator(`[data-review-group="${id}"]`);
    await expect(group).toContainText('Ana');
    await group.getByRole('button', { name: 'Send now' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send review' }).click();
    await expect(group.getByRole('heading', { name: 'Review 1' })).toBeVisible();
    await expect(rows.filter({ hasText: 'Review feedback' }).getByText('Not sent', { exact: true })).toHaveCount(0);
    await rows.getByRole('button', { name: 'Review 1' }).click();
    await expect(page).toHaveURL(new RegExp(`reviewSessionId=${id}`));
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Review feedback');
});
