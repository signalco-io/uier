import { expect, test, type Locator, type Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createProject, openComment, openReply, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** An access token that can reply, named like the coding tool that uses it */
async function replyToken(page: Page, projectName: string) {
    await page.goto('/app/account/coding-agents');
    const section = page.getByRole('region', { name: 'Coding agents' });
    await section.getByRole('button', { name: 'Show access tokens' }).click();
    await section.getByLabel('Token label').fill('Claude Code');
    await section.getByRole('checkbox', { name: projectName, exact: true }).check();
    await section.getByRole('checkbox', { name: 'Reply to feedback', exact: true }).check();
    await section.getByRole('button', { name: 'Create token', exact: true }).click();
    const code = section.locator('code').filter({ hasText: /^uier_mcp\./ });
    await expect(code).toBeVisible();
    return (await code.textContent())!;
}

const longPath = 'packages/toolbar/src/components/'.repeat(4) + 'CommentThreadItem.tsx';
const longUrl = `https://example.com/${'preview-'.repeat(20)}`;
/** What a coding agent replies through MCP: a link around a code span, a list, a code block, a long address */
const agentReply = [
    'Fixed in [`abc1234`](https://github.com/signalco-io/uier/commit/abc1234), deployed to uier.io.',
    '',
    '- The total **wraps** on phones',
    '- ~~Truncated~~ with `text-ellipsis`',
    '',
    '```',
    `pnpm exec playwright test ${longPath}`,
    '```',
    '',
    `Preview: ${longUrl}`,
    '',
    '[Open this](javascript:alert(1)) <img src=x onerror=alert(1)> ![Screenshot](https://example.com/shot.png)'
].join('\n');

/** The reply's Markdown (`body`, the message text), the same in the app and the toolbar */
async function expectFormatted(body: Locator) {
    await expect(body.locator('strong')).toHaveText('wraps');
    await expect(body.locator('del')).toHaveText('Truncated');
    await expect(body.locator('code').filter({ hasText: /^text-ellipsis$/ })).toBeVisible();
    await expect(body.getByRole('list').getByRole('listitem')).toHaveCount(2);
    await expect(body.locator('pre')).toHaveText(`pnpm exec playwright test ${longPath}`);
    const commit = body.getByRole('link', { name: 'abc1234', exact: true });
    await expect(commit).toHaveAttribute('href', 'https://github.com/signalco-io/uier/commit/abc1234');
    await expect(commit).toHaveAttribute('target', '_blank');
    await expect(commit).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    await expect(commit).toHaveAttribute('title', 'https://github.com/signalco-io/uier/commit/abc1234');
    await expect(body.getByRole('link', { name: longUrl, exact: true })).toHaveAttribute('href', longUrl);
    // An image is a link to it, never loaded; a javascript: link and HTML stay the text they were written as
    await expect(body.getByRole('link', { name: 'Screenshot', exact: true })).toHaveAttribute('href', 'https://example.com/shot.png');
    await expect(body).toContainText('[Open this](javascript:alert(1)) <img src=x onerror=alert(1)>');
    await expect(body.getByRole('link')).toHaveCount(3);
    await expect(body.locator('img')).toHaveCount(0);
    // Long code and addresses wrap inside the message
    expect(await body.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await body.evaluate(element => element.ownerDocument.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('Markdown in thread messages reads as formatted text in the app and the toolbar', async ({ page, request, baseURL }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('Mobile');
    const images: string[] = [];
    page.context().on('request', entry => { if (entry.url().includes('shot.png')) images.push(entry.url()); });
    const email = uniqueEmail('markdown');
    const name = email.split('@')[0]!;
    await signIn(page, email);
    const project = await createProject(page, { name: 'Markdown replies', urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'The **total** is cut off on phones', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const { id: commentId } = await response.json() as { id: string };

    const token = await replyToken(page, 'Markdown replies');
    const client = new Client({ name: 'message-markdown-e2e', version: '1.0.0' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        const reply = await client.callTool({ name: 'reply_to_feedback', arguments: { projectId: project, commentId, idempotencyKey: crypto.randomUUID(), text: agentReply } });
        expect(reply.isError).toBeFalsy();
    } finally { await client.close(); }

    // The app: the row reads the words without their Markdown; the thread formats them
    await page.goto(`/app/projects/${project}`);
    const thread = await openComment(page, 'The total is cut off on phones');
    await expect(thread.getByRole('listitem').first().locator('strong')).toHaveText('total');
    await expectFormatted(thread.locator('[data-markdown]').filter({ hasText: 'Fixed in abc1234' }));

    // Markdown typed in the reply box formats as it is written; a mention after bold stays the person's name
    const input = await openReply(thread);
    await input.pressSequentially('**Thanks** @');
    await expect(input.locator('strong')).toHaveText('Thanks');
    const option = thread.getByRole('listbox', { name: 'Mention people' }).getByRole('option').first();
    if (mobile) await option.tap(); else await option.click();
    await expect(input).toHaveText(`Thanks @${name}`, { useInnerText: true });
    await input.press('End');
    await input.pressSequentially('for `#12`');
    await expect(input.locator('code')).toHaveText('#12');
    await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
    const own = thread.getByRole('listitem').filter({ hasText: `Thanks @${name} for #12` });
    await expect(own.locator('[data-mention]')).toHaveText(`@${name}`);
    await expect(own.locator('strong')).toHaveText('Thanks');
    await expect(own.locator('code')).toHaveText('#12');
    await expect(own).not.toContainText('Sending...');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('markdown-app.png'), fullPage: true });

    // The toolbar's thread on the reviewed page formats them the same way
    const review = await page.context().newPage();
    await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
    // Page feedback has no pin: the link opens it in the inbox, with the messages between the first and last folded
    const toolbarThread = review.getByRole('complementary', { name: 'Comments' }).getByRole('article', { name: 'Comment #1', exact: true });
    await expect(toolbarThread.locator('[data-markdown]').first().locator('strong')).toHaveText('total');
    await toolbarThread.getByRole('button', { name: 'Show all 3 messages', exact: true }).click();
    await expectFormatted(toolbarThread.locator('[data-markdown]').filter({ hasText: 'Fixed in abc1234' }));
    await expect(toolbarThread.locator('[data-mention]')).toHaveText(`@${name}`);
    await expectNoAxeViolations(review);
    await review.screenshot({ path: testInfo.outputPath('markdown-toolbar.png') });
    await review.close();
    expect(images).toEqual([]);
});
