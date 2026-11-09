import { expect, test } from '@playwright/test';
import { backToComments, commentRowLink, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('the assignee picks the agent working with them, edits its session, model and reasoning level, and sees its avatar on rows and board cards', async ({ page, request }, testInfo) => {
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
        await expect(commentRows(page).getByRole('button', { name: label, exact: true })).toBeVisible();
        if (mobile) thread = await openComment(page, 'Checkout button fails');
    };

    // Only the assignee adds an agent: none while the thread is unassigned
    await expect(thread.getByRole('button', { name: 'Add agent', exact: true })).toHaveCount(0);
    await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    // The new assignee shows in place once saved; no success toast repeats it
    await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeEnabled();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await thread.getByRole('button', { name: 'Add agent', exact: true }).click();
    // The assignee menu may still be fading out
    const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: 'Claude', exact: true }) });
    await animationsFinished(menu);
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Claude', 'Codex', 'ChatGPT', 'Cursor', 'AI agent']);
    // Each agent shows its own logo beside its name
    for (const [kind, label] of [['claude', 'Claude'], ['codex', 'Codex'], ['chatgpt', 'ChatGPT'], ['cursor', 'Cursor'], ['agent', 'AI agent']])
        await expect(menu.getByRole('menuitemradio', { name: label, exact: true }).locator(`[data-agent-mark="${kind}"]`)).toBeVisible();
    await expectNoAxeViolations(page);
    await menu.getByRole('menuitemradio', { name: 'Claude', exact: true }).click();
    const agent = thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true });
    await expect(agent).toBeEnabled();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    // The thread shows Claude's logo beside its name, once; the row stacks its mark on the assignee's avatar
    await expect(agent.locator('[data-agent-mark="claude"]')).toBeVisible();
    await expect(thread.locator('[data-agent-mark]')).toHaveCount(1);
    await expectRowAvatar('Assigned to you, with Claude');

    // Session id, model and reasoning level are the less common, manual path
    await agent.click();
    await page.getByRole('menuitem', { name: 'Session and model', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Claude details' });
    await animationsFinished(details);
    await details.getByRole('textbox', { name: 'Session id' }).fill('session-42');
    await details.getByRole('textbox', { name: 'Model' }).fill('claude-opus-5-5');
    await details.getByRole('textbox', { name: 'Reasoning level' }).fill('xhigh');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('agent-details.png') });
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(details).toBeHidden();
    // The model reads by name without repeating Claude (the id on hover), the level after a dot without the word
    await expect(agent.locator('[data-agent-model]')).toHaveText('Opus 5.5');
    await expect(agent.locator('[data-agent-model]')).toHaveAttribute('title', 'claude-opus-5-5');
    await expect(agent.locator('[data-agent-reasoning]')).toHaveText('xhigh');
    await expect(agent.locator('[data-agent-reasoning]')).toHaveAttribute('title', 'xhigh reasoning');
    await expectRowAvatar('Assigned to you, with Claude Opus 5.5 (xhigh reasoning)');

    // Saved: after a reload, and on the board's cards
    await page.reload();
    if (mobile) await backToComments(page);
    thread = await openComment(page, 'Checkout button fails');
    const saved = thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true });
    await expect(saved).toContainText('Opus 5.5');
    await expect(saved.locator('[data-agent-reasoning]')).toHaveText('xhigh');
    // The model and reasoning level truncate inside the Assignee field instead of running past it on a phone
    const [button, field] = await Promise.all([saved.boundingBox(), saved.locator('xpath=..').boundingBox()]);
    expect(button!.x + button!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
    await page.screenshot({ path: testInfo.outputPath('agent-thread.png') });
    if (mobile) await backToComments(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Assigned to you, with Claude Opus 5.5 (xhigh reasoning)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    if (mobile) await backToComments(page);

    // The toolbar's thread header names the agent with the assignee (page feedback opens in its inbox)
    const review = await page.context().newPage();
    await review.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${commentId}`);
    await expect(review.getByRole('img', { name: 'Assigned to you, with Claude Opus 5.5 (xhigh reasoning)', exact: true })).toBeVisible();
    await review.screenshot({ path: testInfo.outputPath('agent-toolbar.png') });
    await review.close();

    // Clearing the reasoning level keeps the model, and the dialog opens with what is saved
    thread = await openComment(page, 'Checkout button fails');
    await thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Session and model', exact: true }).click();
    await animationsFinished(details);
    await expect(details.getByRole('textbox', { name: 'Reasoning level' })).toHaveValue('xhigh');
    await details.getByRole('textbox', { name: 'Reasoning level' }).fill('');
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(details).toBeHidden();
    await expect(thread.locator('[data-agent-reasoning]')).toHaveCount(0);
    await expectRowAvatar('Assigned to you, with Claude Opus 5.5');

    // The assignee removes the agent
    await thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove agent', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Add agent', exact: true })).toBeVisible();
    await expectRowAvatar('Assigned to you');
});

test('the avatars on a row show the assignee and their agent on hover, focus or tap, and a click still opens the thread', async ({ page, request }, testInfo) => {
    const email = uniqueEmail('agent-card');
    const name = email.split('@')[0]!;
    await signIn(page, email);
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'Price table wraps', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    await page.goto(`/app/projects/${project}`);
    const thread = await openComment(page, 'Price table wraps');
    await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeEnabled();
    await thread.getByRole('button', { name: 'Add agent', exact: true }).click();
    const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: 'Claude', exact: true }) });
    await animationsFinished(menu);
    await menu.getByRole('menuitemradio', { name: 'Claude', exact: true }).click();
    const agent = thread.getByRole('button', { name: 'Agent: Claude. Change agent', exact: true });
    await expect(agent).toBeEnabled();
    // Off the comment's Device button, which the menu item's place may have put the pointer on (it opens on hover)
    await page.mouse.move(0, 0);
    await agent.click();
    await page.getByRole('menuitem', { name: 'Session and model', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Claude details' });
    await animationsFinished(details);
    // Longer than the card is wide: cut off with an ellipsis, in full in a tooltip
    const sessionId = `session-74-${'a1b2c3d4'.repeat(8)}`;
    await details.getByRole('textbox', { name: 'Session id' }).fill(sessionId);
    await details.getByRole('textbox', { name: 'Model' }).fill('claude-opus-5-5');
    await details.getByRole('textbox', { name: 'Reasoning level' }).fill('high');
    await details.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(details).toBeHidden();

    // A fresh list: no thread chosen yet
    await page.goto(`/app/projects/${project}`);
    const row = commentRows(page).filter({ hasText: 'Price table wraps' });
    const avatars = row.getByRole('button', { name: 'Assigned to you, with Claude Opus 5.5 (high reasoning)', exact: true });
    const card = page.getByRole('dialog', { name: 'Assignee details', exact: true });
    const session = card.locator('[data-agent-session]');
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    const expectCard = async () => {
        await expect(card).toBeVisible();
        await expect(card).toContainText('Assigned to');
        await expect(card).toContainText('You');
        await expect(card.locator('[data-agent="claude"]')).toBeVisible();
        await expect(card).toContainText('Claude');
        // The model by name, the reported id on hover
        await expect(card.locator('[data-agent-model]')).toHaveText('Opus 5.5');
        await expect(card.locator('[data-agent-model]')).toHaveAttribute('title', 'claude-opus-5-5');
        await expect(card).toContainText('high reasoning');
        await expect(card.locator('[data-agent-since]')).toHaveText(/^Started (just now|\d+ minutes? ago)$/);
        await expect(session).toHaveText(`Session ${sessionId}`);
    };

    if (testInfo.project.name.startsWith('Mobile')) {
        // A tap shows the card instead of opening the thread; the rest of the row still opens it
        await avatars.tap();
        await expectCard();
        await expect(page.getByRole('article')).toHaveCount(0);
        await animationsFinished(card);
        await expectNoAxeViolations(page, { include: ['[aria-label="Comments"]', '[aria-label="Assignee details"]'] });
        await page.screenshot({ path: testInfo.outputPath('assignee-card-mobile.png') });
        await page.keyboard.press('Escape');
        await expect(card).toBeHidden();
        await commentRowLink(page, 'Price table wraps').tap();
        await expect(page.getByRole('article')).toBeVisible();
        return;
    }

    // Hovering shows the card; leaving hides it
    await avatars.hover();
    await expectCard();
    await animationsFinished(card);
    // The list and the card: the thread beside the list has its own checks
    await expectNoAxeViolations(page, { include: ['[aria-label="Comments"]', '[aria-label="Assignee details"]'] });
    await page.screenshot({ path: testInfo.outputPath('assignee-card.png') });
    // The cut-off session id in full on hover; the model fits, so it has no tooltip or tab stop
    await session.hover();
    await expect(tooltip).toHaveText(sessionId);
    await expect(card.locator('[data-agent-model]')).not.toHaveAttribute('tabindex');
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();

    // From the row's link, Tab reaches the selection box (under the author), then the avatars, and Enter opens the card; Escape gives the focus back
    const link = commentRowLink(page, 'Price table wraps');
    await link.focus();
    await page.keyboard.press('Tab');
    await expect(row.getByRole('checkbox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(avatars).toBeFocused();
    await page.keyboard.press('Enter');
    await expectCard();
    // Tab reaches the cut-off session id and shows it in full
    await page.keyboard.press('Tab');
    await expect(session).toBeFocused();
    await expect(tooltip).toHaveText(sessionId);
    // Escape closes the tooltip, then the card
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(avatars).toBeFocused();

    // A click on the avatars opens the thread like the rest of the row
    await page.mouse.move(0, 0);
    await avatars.click();
    await expect(page).toHaveURL(/[?&]comment=/);
    await expect(link).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('article')).toContainText('Price table wraps');
    await expect(card).toBeHidden();
});
