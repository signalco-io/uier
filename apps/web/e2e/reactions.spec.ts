import { expect, test, type Locator } from '@playwright/test';
import { createProject, inBackground, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

/** A reaction pill in a message, by its name ("Thumbs up, 2 reactions") */
const reaction = (message: Locator, name: string) => message.getByRole('group', { name: 'Reactions', exact: true }).getByRole('button', { name, exact: true });

/** A touch or pen press held on a control: shows who reacted and does not toggle */
async function holdTouch(control: Locator) {
    await control.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
    await control.page().waitForTimeout(650);
    await control.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, bubbles: true });
    // A touch leaves the control as it lifts
    await control.dispatchEvent('pointerleave', { pointerType: 'touch', isPrimary: true });
    await control.dispatchEvent('click');
}

test('reactions to messages in the app and the toolbar: add, count, who reacted, remove', async ({ page, request }, testInfo) => {
    await signIn(page, uniqueEmail('reactions'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const created = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'The plan names are hard to compare', authorName: 'Reviewer'
    } });
    expect(created.status()).toBe(201);
    const thread = await created.json() as { id: string; thread: { items: { id: string }[] } };
    const replied = await request.post(`/api/review/${project}/comments/${thread.id}/replies`, { headers, data: { text: 'Same on the yearly plans', authorName: 'Reviewer' } });
    expect(replied.status()).toBe(201);
    // A guest's reaction keeps the name they gave
    const guestReaction = await request.post(`/api/review/${project}/comments/${thread.id}/reactions`, { headers, data: {
        itemId: thread.thread.items[0]!.id, emoji: 'thumbs-up', reacted: true, authorName: 'Reviewer'
    } });
    expect(guestReaction.status()).toBe(200);

    // The app: the guest's reaction, then the member adds theirs
    await inBackground(page);
    await page.goto(`/app/projects/${project}`);
    const card = await openComment(page, 'The plan names are hard to compare');
    const first = card.getByRole('listitem').filter({ hasText: 'The plan names are hard to compare' });
    const reply = card.getByRole('listitem').filter({ hasText: 'Same on the yearly plans' });
    const guestOnly = reaction(first, 'Thumbs up, 1 reaction');
    await expect(guestOnly).toHaveAttribute('aria-pressed', 'false');
    await expect(guestOnly).toHaveAccessibleDescription('Reviewer reacted');
    await guestOnly.click();
    const both = reaction(first, 'Thumbs up, 2 reactions');
    await expect(both).toHaveAttribute('aria-pressed', 'true');
    await expect(both).toHaveAccessibleDescription('You and Reviewer reacted');

    // Add reaction on the reply: the quick set, each named by what it shows
    await reply.getByRole('button', { name: 'Add reaction', exact: true }).click();
    const picker = page.getByRole('group', { name: 'Reactions', exact: true }).filter({ has: page.getByRole('button', { name: 'Eyes', exact: true }) });
    await expect(picker.getByRole('button')).toHaveCount(8);
    await expect(picker.getByRole('button', { name: 'Thumbs up', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(picker.getByRole('button', { name: 'Thumbs down', exact: true })).toBeFocused();
    await picker.getByRole('button', { name: 'Heart', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(reaction(reply, 'Heart, 1 reaction')).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations(page, { include: ['[role="article"]'] });
    await page.screenshot({ path: testInfo.outputPath('reactions-app.png') });

    // A long press on a touch screen shows who reacted and changes nothing
    await holdTouch(both);
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'You and Reviewer reacted' })).toBeVisible();
    await expect(both).toHaveAttribute('aria-pressed', 'true');

    // Saved: a reload shows the same
    await page.reload();
    await expect(reaction(page.getByRole('article').getByRole('listitem').filter({ hasText: 'Same on the yearly plans' }), 'Heart, 1 reaction')).toBeVisible();

    // The toolbar's thread on the reviewed page shows them, and the member's own is pressed there too
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}&comment=${thread.id}`);
    const toolbarThread = page.getByRole('complementary', { name: 'Comments' }).getByRole('article', { name: 'Comment #1', exact: true });
    const toolbarFirst = reaction(toolbarThread, 'Thumbs up, 2 reactions');
    await expect(toolbarFirst).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbarFirst).toHaveAccessibleDescription('You and Reviewer reacted');
    await expect(reaction(toolbarThread, 'Heart, 1 reaction')).toHaveAttribute('aria-pressed', 'true');
    await holdTouch(toolbarFirst);
    await expect(page.locator('[data-uier-tooltip]').filter({ hasText: 'You and Reviewer reacted' })).toBeVisible();
    await expect(toolbarFirst).toHaveAttribute('aria-pressed', 'true');
    // Remove the member's thumbs up, add a rocket to the first message from the toolbar's quick set
    await toolbarFirst.click();
    await expect(reaction(toolbarThread, 'Thumbs up, 1 reaction')).toHaveAttribute('aria-pressed', 'false');
    await toolbarThread.getByRole('button', { name: 'Add reaction', exact: true }).first().click();
    const toolbarPicker = page.getByRole('dialog', { name: 'Reactions', exact: true });
    await expect(toolbarPicker.getByRole('button')).toHaveCount(8);
    await expect(toolbarPicker.getByRole('button', { name: 'Thumbs up', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await toolbarPicker.getByRole('button', { name: 'Rocket', exact: true }).click();
    await expect(toolbarPicker).toBeHidden();
    await expect(reaction(toolbarThread, 'Rocket, 1 reaction')).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    await page.screenshot({ path: testInfo.outputPath('reactions-toolbar.png') });

    // The app reads what the toolbar saved
    await page.goto(`/app/projects/${project}`);
    const again = await openComment(page, 'The plan names are hard to compare');
    const firstAgain = again.getByRole('listitem').filter({ hasText: 'The plan names are hard to compare' });
    await expect(reaction(firstAgain, 'Thumbs up, 1 reaction')).toHaveAttribute('aria-pressed', 'false');
    await expect(reaction(firstAgain, 'Rocket, 1 reaction')).toHaveAttribute('aria-pressed', 'true');
    await expect(reaction(firstAgain, 'Rocket, 1 reaction')).toHaveAccessibleDescription('You reacted');
});
