import { expect, test } from '@playwright/test';
import { backToComments, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('the assignee picks the agent working with them, edits its session and model, and sees its avatar on rows and board cards', async ({ page, request }, testInfo) => {
    const email = uniqueEmail('agent');
    const name = email.split('@')[0]!;
    await signIn(page, email);
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'Checkout button fails', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const { id: commentId } = await response.json() as { id: string };
    await page.goto(`/app/projects/${project}`);
    let thread = await openComment(page, 'Checkout button fails');
    // On a phone the thread takes the list's place: go back to see the row, then open the thread again
    const mobile = testInfo.project.name.startsWith('Mobile');
    const expectRowAvatar = async (label: string) => {
        if (mobile) await backToComments(page);
        await expect(commentRows(page).getByRole('img', { name: label, exact: true })).toBeVisible();
        if (mobile) thread = await openComment(page, 'Checkout button fails');
    };

    // Only the assignee adds an agent: none while the thread is unassigned
    await expect(thread.getByRole('button', { name: 'Add agent', exact: true })).toHaveCount(0);
    await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();

    await thread.getByRole('button', { name: 'Add agent', exact: true }).click();
    // The assignee menu may still be fading out
    const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: 'Claude', exact: true }) });
    await animationsFinished(menu);
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Claude', 'Codex', 'ChatGPT', 'Cursor', 'AI agent']);
    await expectNoAxeViolations(page);
    await menu.getByRole('menuitemradio', { name: 'Claude', exact: true }).click();
    const agent = thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true });
    await expect(agent).toBeVisible();
    await expect(page.getByText('Agent set to Claude.', { exact: true })).toBeVisible();
    // Its mark is stacked on the assignee's avatar, in the thread and on the row
    await expect(thread.locator('[data-agent="claude"]')).toBeVisible();
    await expectRowAvatar(`Assigned to ${name}, with Claude`);

    // Session id and model are the less common, manual path
    await agent.click();
    await page.getByRole('menuitem', { name: 'Session and model', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Claude details' });
    await animationsFinished(details);
    await details.getByRole('textbox', { name: 'Session id' }).fill('session-42');
    await details.getByRole('textbox', { name: 'Model' }).fill('claude-opus-5-5');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('agent-details.png') });
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(details).toBeHidden();
    await expect(agent).toContainText('claude-opus-5-5');
    await expectRowAvatar(`Assigned to ${name}, with Claude (claude-opus-5-5)`);

    // Saved: after a reload, and on the board's cards
    await page.reload();
    if (mobile) await backToComments(page);
    thread = await openComment(page, 'Checkout button fails');
    await expect(thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true })).toContainText('claude-opus-5-5');
    await page.screenshot({ path: testInfo.outputPath('agent-thread.png') });
    if (mobile) await backToComments(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('img', { name: `Assigned to ${name}, with Claude (claude-opus-5-5)`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    if (mobile) await backToComments(page);

    // The toolbar's thread header names the agent with the assignee (page feedback opens in its inbox)
    const review = await page.context().newPage();
    await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
    await expect(review.getByRole('img', { name: 'Assigned to you, with Claude (claude-opus-5-5)', exact: true })).toBeVisible();
    await review.screenshot({ path: testInfo.outputPath('agent-toolbar.png') });
    await review.close();

    // The assignee removes the agent
    thread = await openComment(page, 'Checkout button fails');
    await thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove agent', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Add agent', exact: true })).toBeVisible();
    await expectRowAvatar(`Assigned to ${name}`);
});
