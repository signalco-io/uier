import { expect, test, type WebSocketRoute } from '@playwright/test';
import { backToComments, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { animationsFinished, newVisitor, threadOptions } from './support/toolbar';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

for (const colorScheme of ['light', 'dark'] as const) {
    test(`several assignees keep their own agents across app, toolbar, realtime and My work in ${colorScheme}`, async ({ page, browser, request }, testInfo) => {
        test.setTimeout(60_000);
        await page.emulateMedia({ colorScheme });
        const sockets: WebSocketRoute[] = [];
        await page.routeWebSocket('**/api/realtime', socket => { socket.onMessage(() => { sockets.push(socket); socket.send('{"type":"ready"}'); }); });
        const email = uniqueEmail('shared-owner');
        const name = email.split('@')[0]!;
        const teammateEmail = uniqueEmail('shared-teammate');
        const teammateName = teammateEmail.split('@')[0]!;
        await signIn(page, email);
        const project = await createProject(page, { name: 'Shared review', urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        await page.goto('/app/users');
        await page.getByRole('button', { name: 'Invite', exact: true }).click();
        const invitation = page.getByRole('dialog');
        await expect(invitation).toHaveAccessibleName('Invite someone');
        await invitation.getByLabel('Email').fill(teammateEmail);
        await invitation.getByRole('radio', { name: /^Admin/ }).click();
        await invitation.getByRole('button', { name: 'Send invitation' }).click();
        const inviteLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
        const teammate = await newVisitor(browser, testInfo);
        try {
            await teammate.page.goto(inviteLink!);
            await teammate.page.getByRole('button', { name: 'Accept invitation' }).click();
            await expect(teammate.page).not.toHaveURL(/invitation/);
            const headers = await verifiedReviewHeaders(request, project, site.origin());
            const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Shared checkout fix', authorName: 'Reviewer'
            } });
            expect(response.status()).toBe(201);
            const { id } = await response.json() as { id: string };
            await page.goto(`/app/projects/${project}`);
            let thread = await openComment(page, 'Shared checkout fix');
            await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
            // Add the signed-in person second: filters and My work must inspect every assignee.
            for (const person of [teammateName, name]) {
                const option = page.getByRole('menuitemcheckbox', { name: person, exact: true });
                await option.click();
                await expect(option).toBeChecked();
                await expect(option).toBeEnabled();
            }
            await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
            await expect(thread.locator('[data-assignment]')).toHaveCount(2);
            await expect(thread.getByRole('button', { name: 'Add agent', exact: true })).toHaveCount(1);
            for (const label of ['Claude', 'Codex']) {
                await thread.getByRole('button', { name: 'Add agent', exact: true }).click();
                await page.getByRole('menuitemradio', { name: label, exact: true }).click();
                await expect(thread.getByRole('button', { name: `Agent: ${label}. Change agent`, exact: true })).toBeEnabled();
            }
            await thread.getByRole('button', { name: 'Reply', exact: true }).click();
            const draft = thread.getByRole('textbox', { name: 'Reply', exact: true });
            await draft.fill('Keep my draft during assignment updates');
            await teammate.page.goto(`/app/projects/${project}`);
            const otherThread = await openComment(teammate.page, 'Shared checkout fix');
            // Other people's agents are display-only, even for an admin.
            await expect(otherThread.getByRole('button', { name: /Change agent/ })).toHaveCount(0);
            await otherThread.getByRole('button', { name: 'Add agent', exact: true }).click();
            await teammate.page.getByRole('menuitemradio', { name: 'Cursor', exact: true }).click();
            await expect(otherThread.getByRole('button', { name: 'Agent: Cursor. Change agent', exact: true })).toBeEnabled();
            await expect.poll(() => sockets.length).toBeGreaterThan(0);
            sockets.at(-1)!.send('{"type":"comments.changed"}');
            await expect(thread.locator('[data-agent="cursor"]')).toBeVisible();
            await expect(draft).toHaveValue('Keep my draft during assignment updates');
            await expectNoAxeViolations(page, { include: ['[role="article"]'] });
            const mobile = testInfo.project.name.startsWith('Mobile');
            if (mobile) await backToComments(page);
            const avatars = commentRows(page).locator('[data-assignee-card]');
            await expect(avatars.locator('[data-assignee-avatar]')).toHaveCount(2);
            await expect(avatars.locator('[data-agent]')).toHaveCount(3);
            if (mobile) await avatars.tap();
            else { await avatars.focus(); await page.keyboard.press('Enter'); }
            const card = page.getByRole('dialog', { name: 'Assignee details', exact: true });
            const people = card.locator('[data-assignee-details]');
            await expect(people).toHaveCount(2);
            await expect(people.nth(0).locator('[data-agent]')).toHaveCount(1);
            await expect(people.nth(1).locator('[data-agent]')).toHaveCount(2);
            await expect(people.nth(1)).toContainText('You');
            await animationsFinished(card);
            await expectNoAxeViolations(page);
            await page.keyboard.press('Escape');
            await page.getByRole('button', { name: 'Board', exact: true }).click();
            await expect(page.locator('[data-board-card]').locator('[data-assignee-avatar]')).toHaveCount(2);
            await page.goto('/app/my-work');
            await expect(page.getByRole('list', { name: 'Assigned to you', exact: true })).toContainText('Shared checkout fix');
            await page.goto(`/app/projects/${project}?people=assigned`);
            await expect(commentRows(page)).toContainText('Shared checkout fix');
            // The toolbar uses the same two people, preserving the other person's agents on removal.
            await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${id}`);
            const toolbarThread = page.getByRole('article').filter({ hasText: 'Shared checkout fix' });
            await expect(toolbarThread.getByRole('img', { name: /Assigned to .*with Cursor.*you.*with Claude.*with Codex/ })).toBeVisible();
            await (await threadOptions(page, toolbarThread)).getByRole('button', { name: /Change assignee/ }).click();
            const picker = toolbarThread.getByRole('group', { name: 'Assign thread' });
            await expect(picker.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
            await picker.getByRole('button', { name: teammateName, exact: true }).click();
            await expect(picker.getByRole('button', { name: teammateName, exact: true })).toHaveAttribute('aria-pressed', 'false');
            await picker.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(toolbarThread.locator('[data-assignee-avatar]')).toHaveCount(1);
            await expect(toolbarThread.locator('[data-agent]')).toHaveCount(2);
            await page.goto(`/app/projects/${project}`);
            thread = await openComment(page, 'Shared checkout fix');
            await expect(thread.getByRole('button', { name: /Agent: .*Change agent/ })).toHaveCount(2);
            await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();
        } finally { await teammate.context.close(); }
    });
}
