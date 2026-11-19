import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';

test('create an API token, use it in Scalar and revoke it', async ({ page, browser, request, baseURL }) => {
    await signIn(page, uniqueEmail('rest-client'));
    const origin = 'https://api-project.example';
    const project = await createProject(page, { name: 'API project', urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const feedback = await request.post(`/api/review/${project}/comments`, {
        headers: await verifiedReviewHeaders(request, project, origin),
        data: { kind: 'feedback', position: { type: 'page' }, path: '/cart', text: 'Check the total', authorName: 'Reviewer' }
    });
    expect(feedback.status()).toBe(201);
    const { id } = await feedback.json();
    await page.goto('/app/account/api-tokens');
    await page.getByLabel('Token label').fill('Report sync');
    await page.getByRole('checkbox', { name: 'API project' }).check();
    await page.getByRole('checkbox', { name: 'Reply to feedback', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Change status', exact: true }).check();
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
    const secret = page.locator('code').filter({ hasText: /^uier_api\./ });
    await expect(secret).toBeVisible();
    const token = await secret.innerText();
    expect((await page.request.get('/api/v1/projects')).status()).toBe(401);

    const docs = await browser.newPage({ baseURL, viewport: page.viewportSize() });
    try {
        await docs.goto('/developers/api');
        const spec = await (await request.get('/api/v1/openapi.json')).json();
        expect(spec.openapi).toBe('3.0.3');
        expect(Object.values<Record<string, { operationId: string }>>(spec.paths).flatMap(path =>
            Object.values(path).map(op => op.operationId)).sort()).toEqual(['getFeedback', 'listFeedback', 'listProjects', 'listStatuses', 'reply', 'updateStatus']);
        const field = docs.getByRole('textbox', { name: 'Bearer Token' });
        await field.fill(token);
        await field.press('Tab');
        await docs.getByRole('button', { name: 'Test Request (get /projects)', exact: true }).click();
        const result = docs.waitForResponse(response => response.url() === new URL('/api/v1/projects', baseURL).href);
        await docs.getByRole('button', { name: /Send get request to/ }).click();
        const response = await result;
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ items: [{ id: project, name: 'API project' }] });
        await docs.reload();
        await expect(field).toHaveValue('');
    } finally { await docs.close(); }

    const projectPath = `/api/v1/projects/${project}`;
    const threadPath = `${projectPath}/feedback/${id}`;
    const headers = { Authorization: 'Bearer ' + token };
    const statuses = await (await request.get(projectPath + '/statuses', { headers })).json();
    const done = statuses.items.find((status: { category: string }) => status.category === 'done').id;
    expect(await (await request.get(projectPath + '/feedback', { headers })).json()).toMatchObject({
        items: [{ id, path: '/cart', excerpt: 'Check the total' }], next: null
    });
    const reply = await request.post(threadPath + '/replies', {
        headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { text: 'Fixed the total.' }
    });
    expect(reply.status()).toBe(200);
    const update = await request.patch(threadPath, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { statusId: done } });
    expect(update.status()).toBe(200);
    const thread = await (await request.get(threadPath, { headers })).json();
    expect(thread).toMatchObject({ statusId: done, messages: [{ text: 'Check the total' }, { text: 'Fixed the total.' }] });
    await page.getByRole('button', { name: 'Revoke Report sync' }).click();
    await expect(page.getByRole('button', { name: 'Revoke Report sync' })).toHaveCount(0);
    const rejected = await request.get('/api/v1/projects', { headers });
    expect(rejected.status()).toBe(401);
});
