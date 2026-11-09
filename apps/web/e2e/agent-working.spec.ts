import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { backToComments, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

/** Substitute only the hosted socket upgrade; MCP writes and authorized snapshot refreshes are real. */
async function transport(page: Page) {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket('**/api/realtime', socket => {
        socket.onMessage(() => { sockets.push(socket); socket.send('{"type":"ready"}'); });
    });
    return async () => {
        await expect.poll(() => sockets.length).toBeGreaterThan(0);
        sockets.at(-1)!.send('{"type":"comments.changed"}');
    };
}

test('active MCP work refreshes shared avatars, keeps drafts and expires locally with reduced motion', async ({ page, request, baseURL }, testInfo) => {
    await page.clock.install();
    const changed = await transport(page);
    await signIn(page, uniqueEmail('agent-working'));
    const project = await createProject(page, { name: 'Working agent', urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const posted = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'An agent is fixing the price table', authorName: 'Reviewer'
    } });
    expect(posted.status()).toBe(201);
    const { id: commentId } = await posted.json() as { id: string };
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await section.getByLabel('Token label').fill('Claude Code');
    await section.getByRole('checkbox', { name: 'Working agent', exact: true }).check();
    await section.getByRole('checkbox', { name: 'Assign feedback', exact: true }).check();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    const token = (await code.textContent())!;
    const client = new Client({ name: 'working-agent-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name: string, input: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: { projectId: project, commentId, idempotencyKey: randomUUID(), ...input } });
        expect(result.isError).toBeFalsy();
        return result.structuredContent as Record<string, any>;
    };
    const working = (value: boolean) => call('set_feedback_agent_working', { working: value, sessionId: 'active-session' });
    const review = await page.context().newPage();
    await review.clock.install();
    const reviewChanged = await transport(review);
    const myWork = await page.context().newPage();
    await myWork.clock.install();
    const mobile = testInfo.project.name.startsWith('Mobile');
    try {
        await call('set_feedback_agent', { assignToMe: true, sessionId: 'active-session' });
        await page.goto(`/app/projects/${project}`);
        await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
        const toolbarAvatar = review.getByRole('img', { name: 'Assigned to you, with Claude', exact: true });
        await expect(toolbarAvatar).toBeVisible();
        await expect(page.locator('[data-agent-working]')).toHaveCount(0);
        await working(true);
        await changed();
        await reviewChanged();
        const avatars = commentRows(page).getByRole('button', { name: 'Assigned to you, with Claude, working now', exact: true });
        await expect(avatars.locator('[data-agent-working]')).toBeVisible();
        await expect(review.getByRole('img', { name: 'Assigned to you, with Claude, working now', exact: true }).locator('[data-agent-working]')).toBeVisible();
        // The assignee card reports the same live state, by keyboard or tap.
        if (mobile) await avatars.tap();
        else { await avatars.focus(); await page.keyboard.press('Enter'); }
        const card = page.getByRole('dialog', { name: 'Assignee details', exact: true });
        await expect(card.getByText('Working now', { exact: true })).toBeVisible();
        await expect(card.locator('[data-agent-working]')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.getByRole('listitem').filter({ hasText: 'An agent is fixing the price table' }).locator('[data-agent-working]')).toBeVisible();
        await page.getByRole('button', { name: 'List', exact: true }).click();
        const thread = await openComment(page, 'An agent is fixing the price table');
        await expect(thread.locator('[data-agent-working]')).toBeVisible();
        await expect(thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true })).toHaveAttribute('aria-description', 'Claude is working now');
        await thread.getByRole('button', { name: 'Reply', exact: true }).click();
        const draft = thread.getByRole('textbox', { name: 'Reply', exact: true });
        await draft.fill('Keep this reply while the agent works');
        await myWork.goto('/app/my-work');
        await expect(myWork.getByRole('list', { name: 'Assigned to you', exact: true }).locator('[data-agent-working]')).toBeVisible();
        // Clearing presence is realtime, preserves the attachment, status and a human's draft.
        await working(false);
        await changed();
        await reviewChanged();
        await expect(page.locator('[data-agent-working]')).toHaveCount(0);
        await expect(review.locator('[data-agent-working]')).toHaveCount(0);
        await expect(draft).toHaveValue('Keep this reply while the agent works');
        await expect(thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true })).toBeVisible();
        await expect(thread.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeVisible();
        await working(true);
        await changed();
        await reviewChanged();
        await expect(thread.locator('[data-agent-working]')).toBeVisible();
        for (const target of [page, review]) {
            await target.emulateMedia({ reducedMotion: 'no-preference' });
            const indicator = target.locator('[data-agent-working] svg').first();
            await expect.poll(() => indicator.evaluate(node => getComputedStyle(node).animationName)).not.toBe('none');
            await target.emulateMedia({ reducedMotion: 'reduce' });
            await expect.poll(() => indicator.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
        }
        await expectNoAxeViolations(page, { include: ['[role="article"]'] });
        await page.screenshot({ path: testInfo.outputPath('agent-working-thread.png') });
        await review.screenshot({ path: testInfo.outputPath('agent-working-toolbar.png') });
        // Advance only the browser clock: no server cleanup/write or new realtime frame is needed.
        await Promise.all([page.clock.fastForward(301_000), review.clock.fastForward(301_000), myWork.clock.fastForward(301_000)]);
        for (const target of [page, review, myWork]) await expect(target.locator('[data-agent-working]')).toHaveCount(0);
        await expect(draft).toHaveValue('Keep this reply while the agent works');
        if (mobile) await backToComments(page);
        await expect(commentRows(page).getByRole('button', { name: 'Assigned to you, with Claude', exact: true })).toBeVisible();
        await call('clear_feedback_agent', {});
        await changed();
        await reviewChanged();
        await expect(commentRows(page).locator('[data-agent]')).toHaveCount(0);
        await expect(review.locator('[data-agent]')).toHaveCount(0);
    } finally { await client.close(); await Promise.all([review.close(), myWork.close()]); }
});
