import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { backToComments, commentRowLink, commentRows, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// The open thread is marked read for the reader once it has been on screen for a moment (800 ms, the
// toolbar's dwell) in a focused window: beside the list, in the list's place, in the board's sheet and
// from a `?comment=` link. The arrow keys pass threads faster than that, Mark as unread keeps a thread
// unread while it stays open, and a read thread writes nothing.

/** Longer than the automatic read's 800 ms dwell */
const pastDwell = 1500;

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** A project with `count` guest threads ("Guest thread 1" is the oldest), unread for the signed-in owner */
async function inbox(page: Page, request: APIRequestContext, count: number) {
    await signIn(page, uniqueEmail('auto-read'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const ids: Record<number, string> = {};
    for (let index = 1; index <= count; index++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `Guest thread ${index}`, authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        ids[index] = (await response.json()).id;
    }
    return { project, ids };
}

/**
 * The thread ids the page has marked read: `markCommentReadAction(projectId, commentId, sequence)` calls the
 * server has answered (the action runs before its response starts; the response body streams on)
 */
function readWrites(page: Page, project: string) {
    const reads: string[] = [];
    page.on('response', response => {
        const request = response.request();
        if (request.method() !== 'POST' || !request.headers()['next-action'] || new URL(request.url()).pathname !== `/app/projects/${project}`) return;
        try {
            const args: unknown = JSON.parse(request.postData() ?? '');
            if (Array.isArray(args) && args.length === 3 && args[0] === project && typeof args[1] === 'string' && typeof args[2] === 'number') reads.push(args[1]);
        } catch { /* another action's payload */ }
    });
    return reads;
}

const row = (page: Page, index: number) => commentRowLink(page, `Guest thread ${index}`);
const openId = (page: Page) => new URL(page.url()).searchParams.get('comment');

test('beside the list the shown thread is read, and the arrow keys read only the thread they stop on', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The phone layout has its own test');
    await page.setViewportSize({ width: 1280, height: 720 });
    const { project, ids } = await inbox(page, request, 5);
    const reads = readWrites(page, project);
    await page.goto(`/app/projects/${project}`);
    const thread = page.getByRole('article');
    const dot = thread.getByRole('button', { name: 'Unread. Mark as read', exact: true });

    // The first thread is shown in full beside the list: once it has been on screen it is read, the dot,
    // the row and the count change together
    await expect(thread).toContainText('Guest thread 1');
    await expect(dot).toHaveCount(0);
    await expect(row(page, 1)).not.toHaveAccessibleName(/, unread$/);
    await expect(page.getByText('· 4 unread', { exact: true })).toBeVisible();
    await expect.poll(() => reads).toEqual([ids[1]]);

    // Skimming with the keys: only the thread the reader stops on is read
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openId(page)).toBe(ids[4]);
    await expect(thread).toContainText('Guest thread 4');
    await expect(dot).toHaveCount(0);
    await expect.poll(() => reads).toEqual([ids[1], ids[4]]);
    await page.waitForTimeout(pastDwell);
    expect(reads).toEqual([ids[1], ids[4]]);
    await expect(row(page, 2)).toHaveAccessibleName(/, unread$/);
    await expect(row(page, 3)).toHaveAccessibleName(/, unread$/);
    await expect(page.getByText('· 3 unread', { exact: true })).toBeVisible();

    // Saved: after a reload the open thread is already read, so nothing is written again
    await page.reload();
    await expect(thread).toContainText('Guest thread 4');
    await expect(row(page, 1)).not.toHaveAccessibleName(/, unread$/);
    await expect(row(page, 2)).toHaveAccessibleName(/, unread$/);
    await page.waitForTimeout(pastDwell);
    expect(reads).toEqual([ids[1], ids[4]]);

    // Mark as unread keeps the thread unread while it stays open
    await thread.getByRole('button', { name: 'More actions for the comment by guest', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click();
    await expect(dot).toBeVisible();
    await page.waitForTimeout(pastDwell);
    await expect(dot).toBeVisible();
    await expect(row(page, 4)).toHaveAccessibleName(/, unread$/);
    expect(reads).toEqual([ids[1], ids[4]]);
    // Opening another thread reads it; opening this one again reads it again
    await openComment(page, 'Guest thread 5');
    await expect(dot).toHaveCount(0);
    await openComment(page, 'Guest thread 4');
    await expect(dot).toHaveCount(0);
    await expect.poll(() => reads).toEqual([ids[1], ids[4], ids[5], ids[4]]);

    // A link to a thread (`?comment=`, as My work's rows and copied links open it) reads it too
    await page.goto(`/app/projects/${project}?comment=${ids[3]}`);
    await expect(thread).toContainText('Guest thread 3');
    await expect(dot).toHaveCount(0);
    await expect(row(page, 3)).not.toHaveAccessibleName(/, unread$/);
    await expect.poll(() => reads).toEqual([ids[1], ids[4], ids[5], ids[4], ids[3]]);
});

test('where the thread takes the list\'s place, nothing is read until a row is opened', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { project, ids } = await inbox(page, request, 2);
    const reads = readWrites(page, project);
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(2);
    // The first thread is not displayed here, so it is not read
    await page.waitForTimeout(pastDwell);
    expect(reads).toEqual([]);
    await expect(row(page, 2)).toHaveAccessibleName(/, unread$/);

    const thread = await openComment(page, 'Guest thread 2');
    await expect(thread.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
    await expect.poll(() => reads).toEqual([ids[2]]);
    await backToComments(page);
    await expect(row(page, 2)).not.toHaveAccessibleName(/, unread$/);
    await expect(row(page, 1)).toHaveAccessibleName(/, unread$/);
    await expect(page.getByText('· 1 unread', { exact: true })).toBeVisible();
});

test('Only unread keeps the read thread while it is open, the board\'s sheet reads its thread, a failed read comes back', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The phone layout has its own test');
    await page.setViewportSize({ width: 1280, height: 720 });
    const { project, ids } = await inbox(page, request, 4);
    const reads = readWrites(page, project);

    // Once read, the first shown thread is opened: it and its row stay, and the next one is not shown,
    // and read, in its place
    await page.goto(`/app/projects/${project}?unread=true`);
    const thread = page.getByRole('article');
    await expect(thread).toContainText('Guest thread 1');
    await expect.poll(() => openId(page)).toBe(ids[1]);
    await expect(row(page, 1)).not.toHaveAccessibleName(/, unread$/);
    await expect(commentRows(page)).toHaveCount(4);
    await expect(page.getByText('· 3 unread', { exact: true })).toBeVisible();
    await page.waitForTimeout(pastDwell);
    expect(reads).toEqual([ids[1]]);
    await expect(row(page, 2)).toHaveAccessibleName(/, unread$/);
    // Another thread opened: the read one leaves the list, the new one stays while it is open
    await openComment(page, 'Guest thread 2');
    await expect(row(page, 1)).toHaveCount(0);
    await expect(row(page, 2)).not.toHaveAccessibleName(/, unread$/);
    await expect(commentRows(page)).toHaveCount(3);
    await expect.poll(() => reads).toEqual([ids[1], ids[2]]);

    // The board opens a thread in a sheet, which reads it
    await page.goto(`/app/projects/${project}?view=board`);
    await expect(row(page, 3)).toHaveAccessibleName(/, unread$/);
    await row(page, 3).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('article')).toContainText('Guest thread 3');
    await expect(sheet.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
    await expect.poll(() => reads).toEqual([ids[1], ids[2], ids[3]]);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(row(page, 3)).not.toHaveAccessibleName(/, unread$/);

    // A failed write: the dot goes at once and comes back, and the read is not tried again while open
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let attempts = 0;
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.continue();
        attempts++;
        await held;
        await route.abort();
    });
    await row(page, 4).click();
    await expect(sheet.getByRole('article')).toContainText('Guest thread 4');
    const dot = sheet.getByRole('button', { name: 'Unread. Mark as read', exact: true });
    await expect.poll(() => attempts).toBe(1);
    await expect(dot).toHaveCount(0);
    release();
    await expect(dot).toBeVisible();
    await page.waitForTimeout(pastDwell);
    expect(attempts).toBe(1);
    await expect(dot).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row(page, 4)).toHaveAccessibleName(/, unread$/);
    await expect(row(page, 3)).not.toHaveAccessibleName(/, unread$/);
});
