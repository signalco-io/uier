import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { commentRows, createProject, openReply, setProjectAccess, signIn, startSelecting, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The comments list moves with the keyboard like an inbox: ↓ and ↑ go to the next and the previous
// row and stop at the ends, Home and End (from a row) to the first and the last. Beside the list the
// row's thread opens; where the thread takes the list's place, only the focus moves and Enter opens it.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function inbox(page: Page, request: APIRequestContext, count: number) {
    await signIn(page, uniqueEmail('keyboard'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    for (let index = 1; index <= count; index++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `${index % 2 ? 'Odd' : 'Even'} keyboard thread ${index}`,
            authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
    }
    await page.goto(`/app/projects/${project}`);
    await expect(commentRows(page)).toHaveCount(count);
    const links = commentRows(page).getByRole('link');
    // The rows in the list's order: each link's thread id and first line
    const rows = await links.evaluateAll(anchors => anchors.map(anchor => ({
        id: new URL((anchor as HTMLAnchorElement).href).searchParams.get('comment')!,
        text: /(?:Odd|Even) keyboard thread \d+/.exec(anchor.textContent ?? '')![0]
    })));
    return { project, links, rows };
}

const openId = (page: Page) => new URL(page.url()).searchParams.get('comment');
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test('↑ and ↓ open the next and previous threads beside the list, from the list or the page', async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    const { project, links, rows } = await inbox(page, request, 8);
    const thread = page.getByRole('article');
    // Side by side, the first thread is shown until another is chosen
    await expect(thread).toContainText(rows[0]!.text);
    expect(openId(page)).toBeNull();

    // Nothing has the focus: ↓ goes on from the shown thread, opens the next one and focuses its row
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openId(page)).toBe(rows[1]!.id);
    await expect(thread).toContainText(rows[1]!.text);
    await expect(links.nth(1)).toBeFocused();
    await expect(links.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openId(page)).toBe(rows[2]!.id);
    await expect(links.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => openId(page)).toBe(rows[1]!.id);
    await expect(thread).toContainText(rows[1]!.text);

    // A touch screen leaves the selection boxes out until Select is on (a pointer that hovers has them at rest)
    if (testInfo.project.name.startsWith('Mobile')) {
        await startSelecting(page);
        await links.nth(1).focus();
    }
    // One tab stop: Tab goes to the row's selection box (under its author, after its link), then on to the open thread
    await expect(page.locator('[id^="comment-row-"]:not([tabindex="-1"])')).toHaveCount(1);
    await expect(commentRows(page).getByRole('checkbox').and(page.locator(':not([tabindex="-1"])'))).toHaveCount(1);
    const box = (index: number) => commentRows(page).nth(index).getByRole('checkbox');
    await page.keyboard.press('Tab');
    await expect(box(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(thread.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(box(1)).toBeFocused();
    // From a selection box, ↓ moves to the next row's box (and still opens its thread)
    await page.keyboard.press('ArrowDown');
    await expect(box(2)).toBeFocused();
    await expect.poll(() => openId(page)).toBe(rows[2]!.id);
    await page.keyboard.press('Space');
    await expect(box(2)).toBeChecked();

    // End and Home reach the last and the first row and bring it into view; the keys stop there
    await page.keyboard.press('End');
    await expect.poll(() => openId(page)).toBe(rows[7]!.id);
    await expect(commentRows(page).nth(7)).toBeInViewport();
    await page.keyboard.press('ArrowDown');
    await expect(box(7)).toBeFocused();
    expect(openId(page)).toBe(rows[7]!.id);
    await page.keyboard.press('Home');
    await expect.poll(() => openId(page)).toBe(rows[0]!.id);
    await expect(commentRows(page).nth(0)).toBeInViewport();
    await page.keyboard.press('ArrowUp');
    expect(openId(page)).toBe(rows[0]!.id);

    // Never while typing, in the search field or the reply box, or in a menu
    await page.getByRole('searchbox', { name: 'Search feedback' }).focus();
    await page.keyboard.press('ArrowDown');
    expect(openId(page)).toBe(rows[0]!.id);
    const reply = await openReply(thread);
    await reply.fill('Draft that keeps its arrows');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(reply).toBeFocused();
    expect(openId(page)).toBe(rows[0]!.id);
    await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    const menu = page.getByRole('menu');
    await animationsFinished(menu);
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    expect(openId(page)).toBe(rows[0]!.id);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // Reading the open thread (the caret in it): the arrows scroll it instead
    await blur(page);
    await thread.getByText(rows[0]!.text).first().click();
    await page.keyboard.press('ArrowDown');
    expect(openId(page)).toBe(rows[0]!.id);

    // A click or a link chooses where the keys go on from
    await links.nth(4).click();
    await expect.poll(() => openId(page)).toBe(rows[4]!.id);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openId(page)).toBe(rows[5]!.id);
    await page.goto(`/app/projects/${project}?comment=${rows[3]!.id}`);
    await expect(thread).toContainText(rows[3]!.text);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => openId(page)).toBe(rows[2]!.id);
    await expect(links.nth(2)).toBeFocused();

    // Only the shown rows: a search skips the others
    const odd = rows.filter(row => row.text.startsWith('Odd'));
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('Odd');
    await expect(commentRows(page)).toHaveCount(odd.length);
    // The search reaches the address after its debounce; opening a thread before that would drop it
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Odd');
    await links.first().click();
    await expect.poll(() => openId(page)).toBe(odd[0]!.id);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openId(page)).toBe(odd[1]!.id);
    await expect(thread).toContainText(odd[1]!.text);
    await expect(links.nth(1)).toBeFocused();
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
});

test('where the thread takes the list\'s place, the keys move the focus and Enter opens the row', async ({ page, request }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    const { links, rows } = await inbox(page, request, 3);
    const thread = page.getByRole('article');
    await expect(thread).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(1)).toBeFocused();
    expect(openId(page)).toBeNull();
    await page.keyboard.press('Enter');
    await expect(thread).toContainText(rows[1]!.text);
    await expect(commentRows(page).first()).toBeHidden();
    // The list is hidden: the arrows are the page's again
    await page.keyboard.press('ArrowDown');
    expect(openId(page)).toBe(rows[1]!.id);
    await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(2)).toBeFocused();
    expect(openId(page)).toBeNull();
});
