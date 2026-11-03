import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, toolbar } from './support/toolbar';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';

const newLineHint = 'Shift+Enter for a new line';
const draftCue = 'Draft saved in this browser';

async function startPoint(page: Page) {
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    return page.getByRole('dialog', { name: 'New comment', exact: true });
}

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('toolbar composers explain Enter and Shift+Enter where a keyboard has them', async ({ browser }, info) => {
    const touch = Boolean(info.project.use.hasTouch);
    const { context, page } = await newVisitor(browser, info);
    // Phone width on both devices: the hint stays on one readable line
    await page.setViewportSize({ width: 390, height: 844 });
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const draft = await startPoint(page);
    const text = draft.getByRole('textbox', { name: 'Comment', exact: true });
    // A phone's Enter key sends, and says so
    await expect(text).toHaveAttribute('enterkeyhint', 'send');
    if (touch) {
        // No Shift+Enter on an on-screen keyboard: no hint that says there is
        await expect(draft.getByText(newLineHint)).toHaveCount(0);
        await expect(text).not.toHaveAccessibleDescription(/Shift\+Enter/);
    } else {
        const hint = draft.getByText(newLineHint, { exact: true });
        await expect(hint).toBeVisible();
        expect(await hint.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().height < 20)).toBe(true);
        await expect(text).toHaveAccessibleDescription('Enter to send. Shift+Enter for a new line.');
        await text.pressSequentially('First line');
        await page.keyboard.press('Shift+Enter');
        await text.pressSequentially('Second line');
        await expect(text).toHaveValue('First line\nSecond line');
    }
    await page.screenshot({ path: info.outputPath('composer-hint.png') });
    if (touch) await text.fill('First line\nSecond line');
    await page.keyboard.press('Enter');
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread).toContainText('First line');
    await expect(thread).toContainText('Second line');
    const reply = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await expect(reply).toHaveAttribute('enterkeyhint', 'send');
    await expect(thread.getByText(newLineHint, { exact: true })).toHaveCount(touch ? 0 : 1);
    if (!touch) {
        // Editing: Enter saves; the original text is not a saved draft
        await thread.getByRole('button', { name: 'More options for your comment' }).click();
        await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
        const editor = thread.getByRole('textbox', { name: 'Edit comment', exact: true });
        await expect(editor).toHaveAttribute('enterkeyhint', 'done');
        await expect(editor).toHaveAccessibleDescription('Enter to save. Shift+Enter for a new line.');
        await expect(thread.getByText(draftCue)).toHaveCount(0);
        await thread.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await toolbar(page).getByRole('button', { name: 'Send feedback', exact: true }).click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
    await expect(feedback.getByRole('textbox', { name: 'Feedback', exact: true })).toBeVisible();
    await expect(feedback.getByText(newLineHint, { exact: true })).toHaveCount(touch ? 0 : 1);
    await context.close();
});

test('a closed draft is saved in this browser and Resume draft reopens it after a reload', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const resume = page.getByRole('button', { name: 'Resume draft', exact: true });
    const draft = await startPoint(page);
    const text = draft.getByRole('textbox', { name: 'Comment', exact: true });
    await text.fill('Pick this up later');
    // Nothing appears while typing a new draft
    await expect(draft.getByText(draftCue)).toHaveCount(0);
    await expect(resume).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(draft).toBeHidden();
    await expect(resume).toBeVisible();
    await page.screenshot({ path: info.outputPath('resume-draft.png') });

    await page.reload();
    await expect(resume).toBeVisible();
    await expectNoAxeViolations(page);
    // Far from its pin
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const pin = page.locator('[data-uier-comment="new"]');
    await expect(pin).not.toBeInViewport();
    await resume.click();
    await expect(text).toHaveValue('Pick this up later');
    await expect(text).toBeFocused();
    await expect(pin).toBeInViewport();
    await expect(draft.getByText(draftCue, { exact: true })).toBeVisible();
    await expect(text).toHaveAccessibleDescription(new RegExp(draftCue));
    await animationsFinished(draft);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: info.outputPath('resumed-draft.png') });
    // Open: nothing to resume
    await expect(resume).toHaveCount(0);
    await draft.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(pin).toHaveCount(0);
    await expect(resume).toHaveCount(0);
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect(resume).toHaveCount(0);
    await context.close();
});

test('project members and guests see the same keyboard hint', async ({ page, browser }, info) => {
    test.skip(Boolean(info.project.use.hasTouch), 'The hint is for keyboards; touch is covered above');
    await signIn(page, uniqueEmail('composer-hints'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`);
    const member = await startPoint(page);
    await expect(member.getByText('@ to mention', { exact: true })).toBeVisible();
    await expect(member.getByText(newLineHint, { exact: true })).toBeVisible();
    await expect(member.getByRole('textbox', { name: 'Comment', exact: true }))
        .toHaveAccessibleDescription('Type @ to mention someone with access. Enter to send. Shift+Enter for a new line.');

    const { context, page: guestPage } = await newVisitor(browser, info);
    await guestPage.goto(`${site.origin()}/${project}/pricing?review=true`);
    const guest = await startPoint(guestPage);
    await expect(guest.getByRole('textbox', { name: 'Your name' })).toBeVisible();
    await expect(guest.getByText('@ to mention')).toHaveCount(0);
    await expect(guest.getByText(newLineHint, { exact: true })).toBeVisible();
    await expect(guest.getByRole('textbox', { name: 'Comment', exact: true }))
        .toHaveAccessibleDescription('Enter to send. Shift+Enter for a new line.');
    await context.close();
});
