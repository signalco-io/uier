import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { isolatedOrigin, newVisitor, openLanding, toolbar } from './support/toolbar';

const fixture = fileURLToPath(new URL('./fixtures/recording.webm', import.meta.url));

async function startComment(page: Page, text: string) {
    const heading = page.getByRole('heading', { level: 1 });
    await heading.scrollIntoViewIfNeeded();
    await toolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
    const box = await heading.boundingBox();
    await page.mouse.click(box!.x + 20, box!.y + box!.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment', exact: true });
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill(text);
    const omit = draft.getByRole('button', { name: 'Attach screenshot' });
    if (await omit.count()) await omit.click();
    return draft;
}

/** Attach's menu, opened from the composer's text box */
async function openAttachMenu(page: Page, composer: Locator) {
    await composer.getByRole('button', { name: 'Attach', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Attach', exact: true });
    await expect(menu).toBeVisible();
    return menu;
}

async function attachRecording(composer: Locator) {
    await composer.locator('input[type="file"][accept="video/webm,video/mp4"]').setInputFiles(fixture);
    const preview = composer.locator('video[aria-label="Recording preview"]');
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
}

test('recordings: upload, save, play and reload a comment recording', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    try {
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const draft = await startComment(page, 'Watch this interaction.');
        await attachRecording(draft);
        // Media and temporary signed addresses must stay out of the text-only draft store.
        const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
        expect(stored).not.toMatch(/blob:|data:video|recording\.webm|uploadUrl/);
        await draft.getByRole('button', { name: 'Post comment', exact: true }).click();
        const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
        await expect(thread.getByText('Watch this interaction.', { exact: true })).toBeVisible();
        await thread.getByRole('button', { name: /^Load recording/ }).click();
        const video = thread.locator('video[aria-label="Screen recording"]');
        await expect(video).toBeVisible();
        await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
        const reply = thread.locator('form');
        await attachRecording(reply);
        await reply.getByRole('textbox', { name: 'Reply', exact: true }).fill('Here is the second interaction.');
        await reply.getByRole('button', { name: 'Post reply', exact: true }).click();
        await expect(thread.getByText('Here is the second interaction.', { exact: true })).toBeVisible();
        await expect(thread.getByRole('button', { name: /^Load recording/ })).toHaveCount(1);
        const commentId = await page.evaluate(async () => {
            const comments = await (await fetch('/api/comments?path=/')).json() as { id: string; recording?: Record<string, unknown>; thread: { items: { text: string }[] } }[];
            const saved = comments.find(comment => comment.thread.items[0]?.text === 'Watch this interaction.');
            if (!saved?.recording) throw new Error('Recording metadata was not saved');
            if ('url' in saved.recording || 'blob' in saved.recording) throw new Error('Storage credentials leaked into comment metadata');
            return saved.id as string;
        });
        await page.reload();
        await page.locator(`[data-uier-comment="${commentId}"]`).click();
        await expect(thread.getByRole('button', { name: /^Load recording/ })).toHaveCount(2);
    } finally { await context.close(); }
});

test('recordings: explicit capture stops tracks and allows preview and discard', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    try {
        await page.addInitScript(() => {
            const state = window as unknown as { recordingFrames: number; recordingStopped: number; recordingOptions?: DisplayMediaStreamOptions };
            state.recordingFrames = 0;
            state.recordingStopped = 0;
            Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async (options: DisplayMediaStreamOptions) => {
                state.recordingOptions = options;
                const canvas = document.createElement('canvas');
                canvas.width = 160; canvas.height = 90;
                const draw = canvas.getContext('2d')!;
                const stream = canvas.captureStream(10);
                const timer = setInterval(() => {
                    draw.fillStyle = state.recordingFrames++ % 2 ? 'black' : 'white';
                    draw.fillRect(0, 0, 160, 90);
                }, 100);
                const track = stream.getVideoTracks()[0]!;
                const stop = track.stop.bind(track);
                track.stop = () => { state.recordingStopped++; clearInterval(timer); stop(); };
                return stream;
            } });
        });
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const draft = await startComment(page, 'Keep this draft while recording.');
        // One Attach button: its menu has Record screen and Upload recording (and Attach image)
        const menu = await openAttachMenu(page, draft);
        await expect(menu.getByRole('button', { name: 'Upload recording', exact: true })).toBeVisible();
        await expect(menu.getByRole('button', { name: 'Attach image', exact: true })).toBeVisible();
        await menu.getByRole('button', { name: 'Record screen', exact: true }).click();
        await expect(menu).toBeHidden();
        await expect(draft.getByRole('button', { name: 'Stop recording', exact: true })).toBeFocused();
        await expect(draft.getByRole('timer')).toHaveText(/^0:0\d \/ 1:00$/);
        await expect(draft.getByRole('button', { name: 'Post comment', exact: true })).toBeDisabled();
        await page.getByRole('heading', { level: 1 }).click();
        await expect(draft.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => (window as unknown as { recordingFrames: number }).recordingFrames)).toBeGreaterThan(3);
        await draft.getByRole('button', { name: 'Stop recording', exact: true }).click();
        await expect(draft.locator('video[aria-label="Recording preview"]')).toBeVisible();
        // MediaRecorder writes WebM without a length; the capture gets one, so its player can seek.
        await expect.poll(() => draft.locator('video[aria-label="Recording preview"]')
            .evaluate((video: HTMLVideoElement) => Number.isFinite(video.duration) && video.duration > 0)).toBe(true);
        expect(await page.evaluate(() => (window as unknown as { recordingOptions: DisplayMediaStreamOptions }).recordingOptions.audio)).toBe(false);
        await expect.poll(() => page.evaluate(() => (window as unknown as { recordingStopped: number }).recordingStopped)).toBeGreaterThan(0);
        await draft.getByRole('button', { name: 'Discard recording', exact: true }).click();
        await expect(draft.locator('video')).toHaveCount(0);
        await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Keep this draft while recording.');
    } finally { await context.close(); }
});

test('recordings: unavailable capture retains file upload and invalid files retain text', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    try {
        await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: undefined }));
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const draft = await startComment(page, 'A mobile recording can be uploaded.');
        const menu = await openAttachMenu(page, draft);
        await expect(menu.getByRole('button', { name: 'Record screen', exact: true })).toHaveCount(0);
        await expect(menu.getByRole('button', { name: 'Upload recording', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await draft.locator('input[type="file"][accept="video/webm,video/mp4"]').setInputFiles({ name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('This is not a video.') });
        await expect(draft.getByRole('alert')).toContainText('Choose an MP4 or WebM recording.');
        await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('A mobile recording can be uploaded.');
        await attachRecording(draft);
        await expect(draft.getByRole('alert')).toHaveCount(0);
    } finally { await context.close(); }
});

test('recordings: a failed upload keeps the text and clip for retry', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    try {
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const draft = await startComment(page, 'Keep my recording after a network failure.');
        await attachRecording(draft);
        await page.route('**/api/comments/recordings', route => route.request().method() === 'POST'
            ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Recording upload unavailable.' }) })
            : route.continue());
        await draft.getByRole('button', { name: 'Post comment', exact: true }).click();
        await expect(draft.locator('video[aria-label="Recording preview"]')).toBeVisible();
        await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveText('Keep my recording after a network failure.');
        await page.unroute('**/api/comments/recordings');
        await draft.getByRole('button', { name: 'Post comment', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Comment thread', exact: true }).getByRole('button', { name: /^Load recording/ })).toBeVisible();
    } finally { await context.close(); }
});
