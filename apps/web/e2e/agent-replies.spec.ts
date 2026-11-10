import { expect, test, type Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { backToComments, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** An access token that can reply, named like the coding tool that uses it */
async function replyToken(page: Page, projectName: string, name: string) {
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await section.getByLabel('Token label').fill(name);
    await section.getByRole('checkbox', { name: projectName, exact: true }).check();
    await section.getByRole('checkbox', { name: 'Reply to feedback', exact: true }).check();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    return (await code.textContent())!;
}

test('a reply Claude writes through MCP shows "via Claude" with its logo and model in the app and the toolbar', async ({ page, request, baseURL }, testInfo) => {
    await signIn(page, uniqueEmail('agent-reply'));
    const project = await createProject(page, { name: 'Agent replies', urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'The total is cut off on phones', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const { id: commentId } = await response.json() as { id: string };

    const token = await replyToken(page, 'Agent replies', 'Claude Code');
    const client = new Client({ name: 'agent-replies-e2e', version: '1.0.0' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        const reply = await client.callTool({ name: 'reply_to_feedback', arguments: { projectId: project, commentId, idempotencyKey: crypto.randomUUID(),
            text: 'Fixed in abc123, deployed.', model: 'claude-opus-5-5', reasoning: 'xhigh' } });
        expect(reply.isError).toBeFalsy();
    } finally { await client.close(); }

    // The app: "You via Claude", the logo beside the agent's name, the details on hover or click
    await page.goto(`/app/projects/${project}`);
    const mobile = testInfo.project.name.startsWith('Mobile');
    const thread = await openComment(page, 'The total is cut off on phones');
    const message = thread.getByRole('listitem').filter({ hasText: 'Fixed in abc123, deployed.' });
    const via = message.getByRole('button', { name: 'via Claude', exact: true });
    await expect(message).toContainText('You');
    await expect(via.locator('[data-agent-mark="claude"]')).toBeVisible();
    // Only the agent's message: the first one is the reviewer's own
    await expect(thread.locator('[data-message-agent]')).toHaveCount(1);
    await via.click();
    const details = page.getByRole('dialog', { name: 'Claude details' });
    await animationsFinished(details);
    await expect(details).toContainText('Claude wrote this for you.');
    // The model by name, its reported id kept as the title (uier #67)
    await expect(details.locator('[data-agent-model]')).toHaveText('Opus 5.5');
    await expect(details.locator('[data-agent-model]')).toHaveAttribute('title', 'claude-opus-5-5');
    await expect(details).toContainText('xhigh reasoning');
    await expect(details).toContainText('Connection: Claude Code');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('agent-reply-app.png') });
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    if (mobile) await backToComments(page);

    // The toolbar's thread names the agent and its model the same way
    const review = await page.context().newPage();
    await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
    const mark = review.getByRole('img', { name: 'via Claude Opus 5.5 (xhigh reasoning)', exact: true });
    await expect(mark).toBeVisible();
    await expect(mark.locator('[data-agent-mark="claude"]')).toBeVisible();
    await review.screenshot({ path: testInfo.outputPath('agent-reply-toolbar.png') });
    await review.close();
});
