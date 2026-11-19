import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding } from './support/toolbar';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { pngImage } from './support/images';
import { expectNoAxeViolations } from './accessibility';

const fixture = fileURLToPath(new URL('./fixtures/recording.webm', import.meta.url));
// The first message's own picker, not the reply box's
const recordingInput = 'input[type="file"][accept="video/webm,video/mp4"]:not(form *)';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function savedFeedback(page: Page, screenshot?: string) {
    const id = await page.evaluate(async screenshot => {
        const response = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Add the evidence later.', screenshot }) });
        return (await response.json() as { id: string }).id;
    }, screenshot);
    await page.reload();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    return id;
}

const saved = (page: Page, id: string) => page.evaluate(async id => {
    const comments = await (await fetch('/api/comments?path=/')).json() as { id: string; screenshot?: { width: number }; recording?: { id: string; duration: number } }[];
    return comments.find(comment => comment.id === id);
}, id);

test('thread attachments: one Attach button adds a screenshot of the page and a recording to a saved comment', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const origin = isolatedOrigin(testInfo);
    await openLanding(page, origin, { dismissHint: true });
    const id = await savedFeedback(page);
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    const attach = thread.getByRole('button', { name: 'Attach to comment', exact: true });
    const menu = page.getByRole('dialog', { name: 'Attach to comment', exact: true });

    // No row of its own (uier #473): the paperclip is among the first message's actions
    await expect(attach).toBeVisible();
    await expect(thread.getByText('No screenshot', { exact: true })).toHaveCount(0);
    await expect(thread.getByRole('region', { name: 'Screenshot evidence' })).toHaveCount(0);
    await expect(thread.locator('[data-uier-attach-panel]')).toBeHidden();
    const [paperclip, reaction] = await Promise.all([attach.boundingBox(), thread.getByRole('button', { name: 'Add reaction', exact: true }).first().boundingBox()]);
    expect(Math.abs(paperclip!.y + paperclip!.height / 2 - (reaction!.y + reaction!.height / 2))).toBeLessThan(2);

    await attach.click();
    for (const name of ['Take screenshot', 'Attach image', 'Paste image', 'Upload recording'])
        await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('attach-menu.png') });

    // An after-comment screenshot: the toolbar's own capture of the commented part of the page
    await menu.getByRole('button', { name: 'Take screenshot', exact: true }).click();
    await expect(menu).toBeHidden();
    const thumbnail = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100);
    await expect(thread.getByRole('alert')).toHaveCount(0);
    expect((await saved(page, id))?.screenshot?.width).toBeGreaterThan(100);

    // With an image saved, the menu offers only what is still missing
    await attach.click();
    await expect(menu.getByRole('button', { name: 'Upload recording', exact: true })).toBeVisible();
    for (const name of ['Take screenshot', 'Attach image', 'Paste image'])
        await expect(menu.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(thread).toBeVisible();

    // Never an arbitrary file: the picker's types are checked again before anything is read
    await thread.locator(recordingInput).setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
    await expect(thread.getByRole('alert')).toContainText('Choose an MP4 or WebM recording.');
    await thread.locator(recordingInput).setInputFiles(fixture);
    const preview = thread.locator('[data-uier-attach-panel] video[aria-label="Recording preview"]');
    await expect(preview).toBeVisible();
    await expect(thread.getByRole('alert')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('recording-preview.png') });
    await thread.getByRole('button', { name: 'Attach recording', exact: true }).click();
    const load = thread.getByRole('button', { name: /^Load recording/ });
    await expect(load).toBeVisible();
    await expect(preview).toHaveCount(0);
    // Nothing left to add: the button goes, and the new recording takes the focus it had
    await expect(attach).toHaveCount(0);
    await expect(load).toBeFocused();
    expect((await saved(page, id))?.recording?.duration).toBeGreaterThan(0.5);
    await load.click();
    await expect(thread.locator('video[aria-label="Screen recording"]')).toBeVisible();

    await page.reload();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await expect(thumbnail).toBeVisible();
    await expect(load).toBeVisible();
    await expect(attach).toHaveCount(0);

    // Someone else's comment has no Attach
    const other = await newVisitor(browser, testInfo);
    await openLanding(other.page, origin, { dismissHint: true });
    await other.page.locator(`[data-uier-comment="${id}"]`).click();
    const theirs = other.page.getByRole('dialog', { name: 'Comment thread' });
    await expect(theirs.getByText('Add the evidence later.')).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Attach to comment', exact: true })).toHaveCount(0);
    await other.context.close();
    await context.close();
});

test('thread attachments: a screen capture keeps the thread open, and a recording that was not attached is kept', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.addInitScript(() => {
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 160; canvas.height = 90;
            const draw = canvas.getContext('2d')!;
            const stream = canvas.captureStream(10);
            let frames = 0;
            const timer = setInterval(() => { draw.fillStyle = frames++ % 2 ? 'black' : 'white'; draw.fillRect(0, 0, 160, 90); }, 100);
            const track = stream.getVideoTracks()[0]!;
            const stop = track.stop.bind(track);
            track.stop = () => { clearInterval(timer); stop(); };
            return stream;
        } });
    });
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const id = await savedFeedback(page, pngImage);
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    const attach = thread.getByRole('button', { name: 'Attach to comment', exact: true });
    const menu = page.getByRole('dialog', { name: 'Attach to comment', exact: true });
    const panel = thread.locator('[data-uier-attach-panel]');

    // The comment has its screenshot: Attach offers the recording only
    await attach.click();
    await expect(menu.getByRole('button', { name: 'Attach image', exact: true })).toHaveCount(0);
    await menu.getByRole('button', { name: 'Record screen', exact: true }).click();
    await expect(menu).toBeHidden();
    const stop = panel.getByRole('button', { name: 'Stop recording', exact: true });
    await expect(stop).toBeFocused();
    await expect(panel.getByRole('timer')).toHaveText(/^0:0\d \/ 1:00$/);
    // The page can be used while it records: the thread stays, with Stop in reach
    await page.getByRole('heading', { level: 1 }).click();
    await expect(stop).toBeVisible();
    await expect(panel.getByRole('timer')).toHaveText(/^0:0[1-9] \/ 1:00$/);
    await page.keyboard.press('Escape');
    const preview = panel.locator('video[aria-label="Recording preview"]');
    await expect(preview).toBeVisible();
    await expect(thread).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('captured-dark.png') });

    await page.route(`**/api/comments/${id}/recording`, route => route.request().method() === 'POST'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Recording storage unavailable.' }) })
        : route.continue());
    await panel.getByRole('button', { name: 'Attach recording', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The recording could not be attached.');
    await expect(preview).toBeVisible();
    expect((await saved(page, id))?.recording).toBeUndefined();
    await page.unroute(`**/api/comments/${id}/recording`);

    // Closing the thread keeps the clip with its pin
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await expect(preview).toBeVisible();
    await panel.getByRole('button', { name: 'Attach recording', exact: true }).click();
    await expect(thread.getByRole('button', { name: /^Load recording/ })).toBeVisible();
    await expect(preview).toHaveCount(0);
    await expect(attach).toHaveCount(0);
    expect((await saved(page, id))?.recording?.id).toEqual(expect.any(String));
    await context.close();
});

test('thread attachments: addresses that share feedback take a screenshot only for their own comments', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, uniqueEmail('attach-origins'));
    const production = site.origin('production'), alias = site.origin('alias');
    const projectId = await createProject(page, { urls: [production, alias], name: 'Shared evidence' });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const path = `/${projectId}/same`;
    const headers = await verifiedReviewHeaders(request, projectId, production, randomBytes(32).toString('base64url'));
    const created = await request.post(`/api/review/${projectId}/comments`, { headers, data: {
        path, text: 'Left on production', authorName: 'Reviewer', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json() as { id: string }).id;

    // The alias shares production's feedback: the same page there shows the thread
    const host = (origin: string) => origin.replace(/^https?:\/\//, '');
    await page.goto(`/app/projects/${projectId}/settings/environments`);
    const settings = page.getByRole('region', { name: 'Site addresses', exact: true });
    await hydrated(settings.locator('form'));
    await settings.getByRole('combobox', { name: `${host(alias)} shares feedback with`, exact: true }).click();
    await page.getByRole('option', { name: host(production), exact: true }).click();
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Saved.');

    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    const menu = page.getByRole('dialog', { name: 'Attach to comment', exact: true });
    const capture = menu.getByRole('button', { name: 'Take screenshot', exact: true });
    // On the alias, the same path is another document: a capture of it is not this comment's evidence
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${alias}${path}`)}`);
    await expect(page).toHaveURL(new RegExp('alias\\.localhost'));
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await expect(thread.getByText('Left on production', { exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Attach to comment', exact: true }).click();
    await expect(menu.getByRole('button', { name: 'Attach image', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Upload recording', exact: true })).toBeVisible();
    await expect(capture).toHaveCount(0);
    await page.keyboard.press('Escape');

    // On the address it was left on, the page is the comment's own
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}${path}`)}`);
    await expect(page).toHaveURL(new RegExp('production\\.localhost'));
    await page.locator(`[data-uier-comment="${id}"]`).click();
    await thread.getByRole('button', { name: 'Attach to comment', exact: true }).click();
    await capture.click();
    const thumbnail = thread.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100);
});
