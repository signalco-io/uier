import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, dismissFirstRunHint, commentBubbles, newVisitor, selectText, selectionToolbar, toolbar } from './support/toolbar';

// Integration evidence, not a substitute for the hosted/physical-device checklist in
// docs/mvp-launch-verification.md. Local identity/email/BotID use the repository's test mode.
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.setTimeout(90_000);

function siteOrigin(testInfo: TestInfo) {
    // Chromium also exercises cross-site restrictions. The other engines use a separate
    // loopback port: genuine cross-origin HTTP, but same-site and without wildcard DNS.
    return testInfo.project.name.includes('Chrome') ? site.origin() : site.loopbackOrigin;
}

const thread = (page: Page) => page.getByRole('dialog', { name: 'Comment thread', exact: true });
const imageLabel = 'Screenshot of the commented part of the page';

async function startPoint(page: Page) {
    const add = page.getByRole('button', { name: 'Add comment', exact: true });
    await add.focus();
    await add.press('Enter');
    // The advertised keyboard alternative targets the page's first visible element.
    await page.keyboard.press('Enter');
    return page.getByRole('dialog', { name: 'New comment', exact: true });
}

async function post(page: Page, action: () => Promise<unknown>, projectId: string) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/review/${projectId}/comments`
        && response.request().method() === 'POST');
    await action();
    const saved = await response;
    expect(saved.status()).toBe(201);
    return await saved.json() as { id: string; number: number; path: string; kind: string; position: { type: string }; screenshot?: { width: number } };
}

async function expectSavedImage(page: Page) {
    // Assignment and follow/read controls can put lazy evidence below the mobile fold.
    await thread(page).getByRole('region', { name: 'Screenshot evidence' }).scrollIntoViewIfNeeded();
    const thumbnail = thread(page).getByRole('button', { name: imageLabel });
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect((await thumbnail.boundingBox())!.width).toBeLessThanOrEqual(100);
    await thumbnail.focus();
    await thumbnail.press('Enter');
    const expanded = page.getByRole('dialog', { name: 'Screenshot', exact: true });
    await expect(expanded.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    await expanded.getByRole('button', { name: 'Close screenshot' }).click();
    await expect(thumbnail).toBeFocused();
}

test('owner checks installation, shares a review, replies and resolves; the named guest reopens its direct link', async ({ page, browser }, testInfo) => {
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('launch-owner'));
    const projectId = await createProject(page, { urls: [origin], name: 'Launch review' });
    const check = page.getByRole('region', { name: 'Check installation' });
    const popupOpened = page.waitForEvent('popup');
    await check.getByRole('button', { name: 'Check installation', exact: true }).click();
    const checked = await popupOpened;
    await expect(check.getByRole('status', { name: 'Installation result' })).toHaveAttribute('data-result', 'success');
    const shared = await check.getByRole('link', { name: 'Open checked review' }).getAttribute('href');
    expect(shared).toBe(`${origin}/?toolbar-code=${projectId}`);
    await checked.close();
    await setProjectAccess(page, projectId, 'Anyone with the link');

    const guest = await newVisitor(browser, testInfo);
    try {
        await guest.page.goto(shared!);
        const draft = await startPoint(guest.page);
        await draft.getByRole('textbox', { name: 'Your name' }).fill('Ana Launch');
        await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Explain the annual price.');
        await expect(draft.getByRole('img')).toHaveCount(0);
        await expect(draft.getByRole('button', { name: /screenshot/i })).toHaveCount(0);
        const saved = await post(guest.page, () => draft.getByRole('button', { name: 'Post comment' }).click(), projectId);
        expect(saved.screenshot?.width).toBeGreaterThan(0);
        await expectSavedImage(guest.page);
        const publicNumber = thread(guest.page).getByText(`Comment #${saved.number}`, { exact: true });
        expect(await publicNumber.evaluate(element => element.clientWidth > 0 && element.scrollWidth <= element.clientWidth), 'public thread number is not clipped').toBe(true);
        await thread(guest.page).getByRole('textbox', { name: 'Reply' }).fill('Keep this unsent follow-up.');
        await guest.page.keyboard.press('Escape');
        await guest.page.getByRole('button', { name: 'Collapse toolbar' }).click();
        await expect(commentBubbles(guest.page)).toHaveCount(0);
        await guest.page.getByRole('button', { name: 'Expand toolbar' }).click();
        await guest.page.locator(`[data-uier-comment="${saved.id}"]`).click();
        await expect(thread(guest.page).getByRole('textbox', { name: 'Reply' })).toHaveValue('Keep this unsent follow-up.');
        await expect(thread(guest.page)).toContainText('Status: Open');

        await page.goto(`/app/projects/${projectId}`);
        const card = page.getByRole('article', { name: 'Comment by Ana Launch' });
        await expect(card).toContainText('Explain the annual price.');
        await expect(card.getByRole('img', { name: imageLabel })).toBeVisible();
        const directReview = await card.getByRole('link', { name: new RegExp(`${new URL(origin).host}/$`) }).getAttribute('href');
        expect(directReview).toContain(`comment=${saved.id}`);
        await page.goto(directReview!);
        await expect(thread(page)).toContainText('Explain the annual price.');
        await thread(page).getByRole('textbox', { name: 'Reply' }).fill('The annual price is now explained.');
        await thread(page).getByRole('button', { name: 'Post reply' }).click();
        await expect(thread(page)).toContainText('The annual price is now explained.');
        // Exercise the actual Copy link fallback rather than constructing a parallel URL.
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } }));
        await thread(page).getByRole('button', { name: 'Copy link' }).click();
        const directLink = await thread(page).locator('input[readonly]').inputValue();
        expect(new URL(directLink).searchParams.get('uier-comment')).toBe(saved.id);
        await thread(page).getByRole('button', { name: 'Mark as done' }).click();
        await expect(thread(page)).toBeHidden();
        await guest.page.goto(directLink);
        // Resolved threads intentionally have no page pin; their direct links open the Done inbox.
        const doneCard = guest.page.getByRole('complementary', { name: 'Comments' }).getByRole('article');
        await expect(doneCard).toContainText('The annual price is now explained.');
        await expect(doneCard).toContainText('Status: Done');
        // A recovered reply draft keeps even a Done thread pinned. Wait for the durable
        // status write rather than using the pin count as evidence that Reopen finished.
        const reopened = guest.page.waitForResponse(response => new URL(response.url()).pathname === `/api/review/${projectId}/comments/${saved.id}`
            && response.request().method() === 'PATCH');
        await doneCard.getByRole('button', { name: 'Reopen' }).click();
        const reopenResponse = await reopened;
        expect(reopenResponse.status()).toBe(200);
        expect((await reopenResponse.json()).resolved).toBe(false);
        await expect(commentBubbles(guest.page)).toHaveCount(1);
        await guest.page.reload();
        await guest.page.locator(`[data-uier-comment="${saved.id}"]`).click();
        await expect(thread(guest.page)).toContainText('Status: Open');
        await animationsFinished(thread(guest.page));
        await expectNoAxeViolations(guest.page);
        await guest.page.screenshot({ path: testInfo.outputPath('launch-light.png') });
    } finally { await guest.context.close(); }
});

test.describe('dark theme and reduced motion', () => {
    test.use({ colorScheme: 'dark', reducedMotion: 'reduce' });

    test('text, rewrite and page feedback keep canonical routes, saved evidence and changed-anchor recovery', async ({ page }, testInfo) => {
        const origin = siteOrigin(testInfo);
        await signIn(page, uniqueEmail('launch-routes'));
        const projectId = await createProject(page, { urls: [origin], name: 'Launch routes' });
        const settings = page.getByRole('region', { name: 'Page state' });
        await page.goto(`/app/projects/${projectId}/settings`);
        await settings.getByLabel('Meaningful query fields').fill('tab');
        await settings.getByLabel('Use hash routes (#/page or #!/page)').check();
        await settings.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(settings.getByRole('status')).toContainText('Saved.');
        const path = `/${projectId}/pricing?tab=annual#/plans`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${origin}${path}`)}`);
        await expect(toolbar(page)).toBeVisible();
        await expect(page.locator('[data-uier-root]')).toHaveClass('dark');
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

        const savedIds: string[] = [];
        for (const rewrite of [false, true]) {
            // Selection is browser DOM Range emulation; physical touch selection handles are manual evidence.
            await selectText(page, 'Every plan includes the toolbar.');
            await selectionToolbar(page).getByRole('button', { name: rewrite ? 'Rewrite' : 'Add comment', exact: true }).click();
            const draft = page.getByRole('dialog', { name: rewrite ? 'New rewrite suggestion' : 'New comment', exact: true });
            await draft.getByRole('textbox', { name: rewrite ? 'Suggested text' : 'Comment', exact: true })
                .fill(rewrite ? 'The toolbar is included in every plan.' : 'Clarify what is included.');
            await expect(draft.getByRole('img')).toHaveCount(0);
            const saved = await post(page, () => draft.getByRole('button', { name: rewrite ? 'Post suggestion' : 'Post comment' }).click(), projectId);
            expect(saved.path).toBe(path);
            expect(saved.position.type).toBe('text');
            savedIds.push(saved.id);
            await expectSavedImage(page);
            await page.keyboard.press('Escape');
            await page.evaluate(() => getSelection()?.removeAllRanges());
        }

        for (const bug of [false, true]) {
            await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
            const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
            await feedback.getByRole('button', { name: bug ? 'Bug report' : 'Feedback', exact: true }).click();
            await feedback.getByRole('textbox', { name: bug ? 'Bug report' : 'Feedback', exact: true })
                .fill(bug ? 'The annual toggle does not update.' : 'The plan comparison is useful.');
            await expect(feedback.getByRole('img')).toHaveCount(0);
            const saved = await post(page, () => feedback.getByRole('button', { name: bug ? 'Send bug report' : 'Send feedback' }).click(), projectId);
            expect(saved).toMatchObject({ path, kind: bug ? 'bug' : 'feedback', position: { type: 'page' } });
            expect(saved.screenshot?.width).toBeGreaterThan(0);
            await expect(feedback).toBeHidden();
        }

        await page.evaluate(() => history.pushState(null, '', location.href.replace('tab=annual', 'tab=monthly')));
        await expect(commentBubbles(page)).toHaveCount(0);
        await page.goBack();
        await expect(commentBubbles(page)).toHaveCount(2);
        await page.reload();
        await expect(commentBubbles(page)).toHaveCount(2);
        // Hidden and missing anchors keep details in the inbox without unrelated fallback pins.
        await page.locator('main p').evaluate(element => { (element as HTMLElement).style.display = 'none'; });
        await expect(commentBubbles(page)).toHaveCount(0);
        await page.locator('main p').evaluate(element => element.remove());
        await expect(commentBubbles(page)).toHaveCount(0);
        await page.getByRole('button', { name: /^Inbox/ }).click();
        const inbox = page.getByRole('complementary', { name: 'Comments' });
        await expect(inbox.getByText('Target is missing from this page.')).toHaveCount(2);
        await expect(inbox).toContainText('Clarify what is included.');
        await expectNoAxeViolations(page);
        await page.screenshot({ path: testInfo.outputPath('launch-dark.png') });
    });
});

test('recovery and keyboard movement preserve host styles, focus and reachable controls after viewport changes', async ({ page }, testInfo) => {
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('launch-host'));
    const projectId = await createProject(page, { urls: [origin], name: 'Host isolation' });
    const host = `${origin}/${projectId}/pricing?host-probe=1`;
    await page.goto(host);
    await expect(toolbar(page)).toHaveCount(0);
    const hostStyles = () => page.locator('#host-probe').evaluate(element => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, radius: style.borderRadius, font: style.fontFamily };
    });
    const before = await hostStyles();
    let failing = true;
    await page.route(`**/api/review/${projectId}/comments?*`, route => failing
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
        : route.continue());
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(host)}`);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({ timeout: 20_000 });
    await dismissFirstRunHint(page);
    await page.getByRole('button', { name: 'Host interaction' }).click();
    await expect(page.locator('#host-probe')).toHaveAttribute('data-clicks', '1');
    failing = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(toolbar(page)).toBeVisible();
    expect(await hostStyles()).toEqual(before);
    const add = page.getByRole('button', { name: 'Add comment', exact: true });
    expect(await add.evaluate(element => getComputedStyle(element).borderRadius)).not.toBe('0px');
    expect(await toolbar(page).evaluate(element => getComputedStyle(element).textTransform)).toBe('none');

    const handle = page.getByRole('button', { name: 'Move toolbar', exact: true });
    await handle.focus();
    await handle.press('Shift+ArrowUp');
    await expect(handle).toBeFocused();
    const savedPosition = await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'));
    expect(savedPosition).not.toBeNull();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    const panelHandle = inbox.getByRole('button', { name: 'Move comments panel' });
    await panelHandle.press('ArrowLeft');
    await expect(inbox).toHaveAttribute('data-side', 'left');
    await expect(panelHandle).toBeFocused();
    await panelHandle.press('ArrowRight');
    await expect(inbox).toHaveAttribute('data-side', 'right');
    if (testInfo.project.use.hasTouch) {
        for (const control of [handle, panelHandle]) {
            const box = (await control.boundingBox())!;
            expect(box.width, 'touch control width').toBeGreaterThanOrEqual(44);
            expect(box.height, 'touch control height').toBeGreaterThanOrEqual(44);
        }
    }
    // This emulates layout/orientation and keyboard-reduced space, not a physical OS keyboard.
    for (const size of [{ width: 320, height: 280 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        await expect.poll(async () => {
            const boxes = await Promise.all([toolbar(page).boundingBox(), inbox.boundingBox()]);
            return boxes.every(box => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1);
        }).toBe(true);
    }
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('uier:toolbar-position:v1'))).toBe(savedPosition);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(inbox).toHaveAttribute('data-side', 'right');
    await animationsFinished(inbox);
    await expectNoAxeViolations(page);
});
