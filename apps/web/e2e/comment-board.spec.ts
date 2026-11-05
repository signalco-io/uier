import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function board(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('board'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const comments: { id: string; number: number }[] = [];
    for (const text of ['First board thread', 'Second board thread']) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        comments.push(await response.json());
    }
    await page.goto(`/app/projects/${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    return { project, comments, column };
}

test('board cards move with Move from the keyboard; Ready to verify asks for the request first', async ({ page, request }) => {
    const { comments, column } = await board(page, request);
    const move = column('Open').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true });
    await move.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Ready to verify', 'Done']);
    await animationsFinished(menu);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await page.reload();
    await expect(column('Done').getByRole('listitem').filter({ hasText: 'First board thread' })).toBeVisible();

    // Ready to verify opens the thread with the form; the card stays until the request is sent
    await column('Open').getByRole('button', { name: `Move comment #${comments[1]!.number}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ready to verify', exact: true }).click();
    const thread = page.getByRole('article');
    const form = thread.getByRole('form', { name: 'Request verification' });
    await expect(form.getByRole('textbox', { name: 'Fix summary', exact: true })).toBeFocused();
    await form.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Moved on the board');
    await form.getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
});

test('board cards drag between the columns they can move to', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Dragging takes a mouse; Move covers touch screens');
    const { column } = await board(page, request);
    const second = column('Open').getByRole('listitem').filter({ hasText: 'Second board thread' });
    await second.dragTo(column('Done'));
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    // Back to Open: Reopen
    await column('Done').getByRole('listitem').dragTo(column('Open'));
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    // Dropped on Ready to verify: the request form opens; the card moves once it is sent
    await column('Open').getByRole('listitem').filter({ hasText: 'First board thread' }).dragTo(column('Ready to verify'));
    const thread = page.getByRole('article');
    await thread.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Dragged to Ready to verify');
    await thread.getByRole('form', { name: 'Request verification' }).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    // The card opens its thread from the board too
    await expect(await openComment(page, 'Second board thread')).toHaveAccessibleName('Comment by Reviewer');
});
