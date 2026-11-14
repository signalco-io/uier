import { enableProjectVerification } from './support/app';
import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';
import { commentRowLink, createProject, openCommentFilters, selectThread, heldForDrag, longPress, openBoardMove, openComment, selectionBar, setProjectAccess, signIn, uniqueEmail, type ProjectAccessLabel } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function board(page: Page, request: APIRequestContext, { access }: { access?: ProjectAccessLabel } = {}) {
    await signIn(page, uniqueEmail('board'));
    const project = await createProject(page, { urls: [site.origin()] });
    await enableProjectVerification(page, project);
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
    if (access) await setProjectAccess(page, project, access);
    await page.goto(`/app/projects/${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    const card = (name: string, text: string) => column(name).getByRole('listitem').filter({ hasText: text });
    return { project, headers, comments, column, card };
}

/**
 * Whether a card's Move is on screen. At rest it is visually hidden (`sr-only`: clipped to nothing, out of the
 * layout), as pointers drag the card; it shows while the card has keyboard focus or its menu is open.
 */
const moveShown = (move: Locator) => move.evaluate(button => getComputedStyle(button).clipPath === 'none' && getComputedStyle(button).position !== 'absolute');

/** The lifted copy of the dragged card and the place it would land (visual only, hidden from assistive tech) */
const dragPreview = (page: Page) => page.locator('[data-drag-preview]');
const placeholder = (column: Locator) => column.locator('[data-drop-placeholder]');

/** Presses a card and moves the mouse in steps, as a person does: the card lifts after a few pixels */
async function dragWithMouse(page: Page, card: Locator, target: Locator, { drop = true } = {}) {
    // The last card has settled
    await expect(dragPreview(page)).toHaveCount(0);
    const from = (await card.boundingBox())!;
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await expect(dragPreview(page)).toBeVisible();
    // Below the column's heading, inside it however tall it is
    const to = (await target.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 10 });
    if (drop) await page.mouse.up();
}

/** Held on a touch screen, the card lifts once the finger moves; then it follows the finger */
async function dragWithTouch(page: Page, card: Locator, target: Locator) {
    // Keep the gesture away from the viewport edge: taller cards can trigger auto-scroll,
    // moving the destination away from the coordinates captured below.
    await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const session = await page.context().newCDPSession(page);
    const from = (await card.boundingBox())!;
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    // Held: the card is ready to lift, but only a move lifts it (before the long press, which would select it instead)
    await heldForDrag(card);
    expect(await dragPreview(page).count()).toBe(0);
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + 16 }] });
    await expect(dragPreview(page)).toBeVisible();
    await expect(card).not.toHaveAttribute('data-hold');
    const to = (await target.boundingBox())!;
    // On a phone the column beside only peeks in at the window's edge: aim at the part on screen
    const end = { x: Math.min(to.x + to.width / 2, page.viewportSize()!.width - 12), y: to.y + 40 };
    for (let step = 1; step <= 10; step++)
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10 }] });
    await expect(target).toHaveAttribute('data-drop', 'over');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('board cards move with Move from the keyboard; Ready to verify asks for the request first', async ({ page, request }) => {
    const { comments, column, card } = await board(page, request);
    const move = column('Open').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true });
    // Pointers drag the card: Move is not on screen at rest, under the pointer either, but screen readers find it
    await card('Open', 'First board thread').hover();
    await expect.poll(() => moveShown(move)).toBe(false);
    await expect(move).toBeAttached();
    // A focused card shows its Move, and says how to open it
    const link = commentRowLink(column('Open'), comments[0]!.number);
    await link.focus();
    await expect(link).toHaveAccessibleDescription('Press M to move it to another column.');
    await expect(link).toHaveAttribute('aria-keyshortcuts', 'M');
    await expect.poll(() => moveShown(move)).toBe(true);
    // M opens Move with the first column highlighted, as Enter on Move does
    await page.keyboard.press('m');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'In progress', 'Ready to verify', 'Done']);
    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
    await expect.poll(() => moveShown(move)).toBe(true);
    await animationsFinished(menu);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    // The focus follows the card to its new column, and the move is announced
    const moved = column('Done').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true });
    await expect(moved).toBeFocused();
    await expect.poll(() => moveShown(moved)).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: `Comment #${comments[0]!.number} moved to Done.` })).toBeAttached();
    // Tab reaches Move from the card's link too; Escape closes its menu and leaves the card where it was
    await commentRowLink(column('Open'), comments[1]!.number).focus();
    await page.keyboard.press('Tab');
    const second = column('Open').getByRole('button', { name: `Move comment #${comments[1]!.number}`, exact: true });
    await expect(second).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(second).toBeFocused();
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await page.reload();
    await expect(column('Done').getByRole('listitem').filter({ hasText: 'First board thread' })).toBeVisible();

    // Ready to verify opens the thread with the form; the card stays until the request is sent
    await openBoardMove(page, comments[1]!.number, column('Open'));
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

/** Where an element sits in the page's scrolling panel (`room` leaves out its scrollbar) */
function placement(target: Locator) {
    return target.evaluate(element => {
        let scroller = element.parentElement!;
        while (getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement!;
        const box = element.getBoundingClientRect();
        const panel = scroller.getBoundingClientRect();
        return { width: box.width, room: scroller.clientWidth, left: box.left - panel.left, right: panel.left + scroller.clientWidth - box.right };
    });
}

/** The parts of the page around the comments: the header, the comments section and the search */
function pageParts(page: Page) {
    return Promise.all([
        page.getByRole('heading', { level: 1 }),
        page.locator('#comments'),
        page.locator('#feedback-search')
    ].map(placement));
}

const boardStatuses = ['Open', 'In progress', 'Ready to verify', 'Done'];

test('the board widens on a wide window, the filters and project headers and the count line with it; the page stays in the reading column', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Desktop windows; a phone has its own test');
    // The window the feedback came from
    await page.setViewportSize({ width: 1674, height: 1366 });
    const { column } = await board(page, request);
    const grid = page.locator('[data-board-scroll]');
    const columns = () => Promise.all(boardStatuses.map(name => placement(column(name))));
    const atBoard = await pageParts(page);
    const view = page.getByRole('group', { name: 'View', exact: true });
    const search = page.locator('[data-slot="input-group"]').filter({ has: page.locator('#feedback-search') });
    // The project header: its mark (the first part of the title's row) and the settings button at the row's end
    const mark = page.getByRole('heading', { level: 1 }).locator('xpath=../../*[1]');
    const settings = page.getByRole('main').getByLabel('Settings', { exact: true });
    // The count line: the guests' threads are unread, so it shows their count (uier #187). With this room it is in the
    // search row (uier #300), left of the search, which is directly left of Filter and the view toggle (uier #403)
    const unread = page.getByRole('status').filter({ hasText: /^\d+ unread$/ });
    const countLine = unread.locator('xpath=..');
    const filter = page.getByRole('button', { name: /^Filter/ });
    // The filters and project headers are full width from the left (uier #363): the project's mark starts with the
    // first column, the view toggle and the settings button end at the page's right edge, the panel less its 32 px
    // gutter, however far the columns reach; the search is directly left of Filter (uier #403), and the count line is
    // left of the search
    const headerSpans = async (first: Locator) => {
        const left = (await placement(first)).left, right = 32;
        expect(left).toBeCloseTo(32, 0);
        expect((await placement(view)).right).toBeCloseTo(right, 0);
        expect((await placement(mark)).left).toBeCloseTo(left, 0);
        expect((await placement(settings)).right).toBeCloseTo(right, 0);
        const searchBox = (await search.boundingBox())!, lineBox = (await countLine.boundingBox())!, filterBox = (await filter.boundingBox())!;
        const viewBox = (await view.boundingBox())!;
        expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(searchBox.x);
        expect(filterBox.x - (searchBox.x + searchBox.width)).toBeCloseTo(8, 0);
        expect(filterBox.x + filterBox.width).toBeLessThanOrEqual(viewBox.x);
        expect(Math.abs((lineBox.y + lineBox.height / 2) - (filterBox.y + filterBox.height / 2))).toBeLessThan(4);
    };
    // The page keeps the reading width, 64rem with the 32 px gutters, centred
    const comments = atBoard[1]!;
    expect(comments.width).toBe(1024 - 64);
    expect(comments.left).toBeCloseTo(comments.right, 0);
    // The board takes the panel edge to edge (padded by its gutters), with an equal column per status in one row,
    // each up to 20rem
    const wide = await placement(grid);
    expect(wide.width).toBeCloseTo(wide.room, 0);
    expect(wide.left).toBeCloseTo(0, 0);
    const boxes = await Promise.all(boardStatuses.map(async name => (await column(name).boundingBox())!));
    for (const box of boxes) {
        expect(box.y).toBeCloseTo(boxes[0]!.y, 0);
        expect(box.width).toBeCloseTo(boxes[0]!.width, 0);
    }
    expect(boxes[0]!.width).toBeGreaterThan(300);
    expect(boxes[0]!.width).toBeLessThanOrEqual(320);
    // Archive comes last, a 3rem strip while collapsed; the headers end with it
    const archive = column('Archived');
    const strip = (await archive.boundingBox())!;
    expect(strip.width).toBe(48);
    expect(strip.x).toBeCloseTo(boxes.at(-1)!.x + boxes.at(-1)!.width + 16, 0);
    await headerSpans(column('Open'));

    // The list: the comments are where the board had them; the filters and project headers and the count line span
    // the list and the thread beside it
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const list = page.getByRole('list', { name: 'Comments', exact: true });
    await expect(list).toBeVisible();
    await expect(page.locator('[data-board-scroll]')).toHaveCount(0);
    const atList = await pageParts(page);
    expect(atList[1]).toEqual(atBoard[1]);
    // The list with its thread beside it is the wide element now
    const split = list.locator('xpath=..');
    await headerSpans(list);
    expect((await placement(split)).right).toBeCloseTo(32, 0);
    // The status tabs start the row, at the list's left edge (uier #405), the search on the right
    const listBox = (await list.boundingBox())!;
    const tabsBox = (await page.getByRole('group', { name: 'Status', exact: true }).boundingBox())!;
    expect(tabsBox.x).toBeCloseTo(listBox.x, 0);
    expect(tabsBox.x + tabsBox.width).toBeLessThan((await search.boundingBox())!.x);
    // A search with no result: its empty state is as wide as the header, from the status tabs to the view toggle (uier #383)
    const headerLeft = (await placement(list)).left;
    await page.locator('#feedback-search').fill('nothing matches this');
    const empty = page.locator('[data-slot="empty"]').filter({ hasText: 'Nothing here' });
    await expect(empty).toBeVisible();
    const emptyPlacement = await placement(empty);
    expect(emptyPlacement.left).toBeCloseTo(headerLeft, 0);
    expect(emptyPlacement.right).toBeCloseTo(32, 0);
    await page.locator('#feedback-search').fill('');
    await expect(list).toBeVisible();

    // On a very wide window the columns stop at 20rem and start at the left, under the search (uier #363); the page keeps the reading width
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect.poll(async () => (await placement(grid)).width).toBeGreaterThan(2000);
    const widest = await columns();
    for (const box of widest) expect(box.width).toBe(320);
    const first = widest[0]!, last = await placement(archive);
    expect(first.room - first.left - last.right).toBe(4 * 320 + 4 * 16 + 48);
    expect(first.left).toBeCloseTo(32, 0);
    expect(last.right).toBeGreaterThan(32);
    await headerSpans(column('Open'));
    const [, widestComments] = await pageParts(page);
    expect(widestComments!.width).toBe(1024 - 64);
    expect(widestComments!.left).toBeCloseTo(widestComments!.right, 0);

    // A card's thread opens in the sheet over the board, which keeps its columns (inert under the sheet,
    // so measured without the accessibility tree)
    const columnBoxes = () => grid.evaluate(element => [...element.children].map(child => {
        const { left, width } = child.getBoundingClientRect();
        return { left, width };
    }));
    const beforeSheet = await columnBoxes();
    await expect(await openComment(page, 'First board thread')).toHaveAccessibleName('Comment by Reviewer');
    expect(await columnBoxes()).toEqual(beforeSheet);

    // A smaller laptop: the panel is narrower than the reading width, so the board and the page share it.
    // The four columns keep a readable 18rem and the board scrolls sideways, edge to edge of the panel so the
    // columns pass under its edges; the page does not
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => (await placement(grid)).width).toBeLessThan(1024);
    const [, laptopComments] = await pageParts(page);
    const laptopGrid = await placement(grid);
    expect(laptopGrid.width).toBeCloseTo(laptopComments!.width + 64, 0);
    expect(laptopGrid.left).toBeCloseTo(0, 0);
    for (const name of boardStatuses) expect((await column(name).boundingBox())!.width).toBeGreaterThanOrEqual(288);
    const scroll = () => grid.evaluate(element => ({ width: element.scrollWidth, room: element.clientWidth, left: element.scrollLeft }));
    const scrolling = await scroll();
    expect(scrolling.width).toBeGreaterThan(scrolling.room);
    // From its start: the first column is not cut off on the left
    expect(scrolling.left).toBe(0);
    // At either end the first and the last column line up with the page's content
    expect((await placement(column('Open'))).left).toBeCloseTo(laptopComments!.left, 0);
    // The filters and project headers stay at the panel's width less the gutters and do not scroll with the board
    const headers = async () => ({ search: await placement(search), view: await placement(view), mark: await placement(mark), settings: await placement(settings) });
    const laptopHeader = await headers();
    expect(laptopHeader.view.right).toBeCloseTo(laptopComments!.right, 0);
    expect(laptopHeader.mark.left).toBeCloseTo(laptopComments!.left, 0);
    expect(laptopHeader.settings.right).toBeCloseTo(laptopComments!.right, 0);
    // The count line stays in the search row, left of the search and Filter
    const laptopLine = (await countLine.boundingBox())!, laptopFilter = (await filter.boundingBox())!;
    expect(laptopLine.x + laptopLine.width).toBeLessThanOrEqual(laptopFilter.x);
    expect(Math.abs((laptopLine.y + laptopLine.height / 2) - (laptopFilter.y + laptopFilter.height / 2))).toBeLessThan(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(archive).toBeInViewport({ ratio: 1 });
    expect((await placement(archive)).right).toBeCloseTo(laptopComments!.right, 0);
    expect(await headers()).toEqual(laptopHeader);

    // Expanded, Archive is a column like the others, and the headers end with it again
    await page.setViewportSize({ width: 2560, height: 1440 });
    await archive.getByRole('button', { name: 'Archive 0', exact: true }).click();
    await expect(archive.getByText('Nothing archived.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await placement(archive)).width).toBe(320);
    const expanded = await placement(column('Open'));
    expect(expanded.room - expanded.left - (await placement(archive)).right).toBe(5 * 320 + 4 * 16);
    await headerSpans(column('Open'));
    await archive.getByRole('button', { name: 'Collapse Archive', exact: true }).click();
    await expect(archive.getByRole('button', { name: 'Archive 0', exact: true })).toBeVisible();
});

test('the board filters by status from Filter, and Select shown results takes only that status (uier #335)', async ({ page, request }) => {
    const { project, comments, column } = await board(page, request);
    const bar = selectionBar(page);
    await selectThread(page, comments[0]!.number);
    await bar.getByRole('button', { name: 'Mark selected as done', exact: true }).click();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await (await openCommentFilters(page)).getByRole('combobox', { name: 'Status filter', exact: true }).click();
    await page.getByRole('option', { name: /^Done/ }).click();
    await page.keyboard.press('Escape');
    expect(new URL(page.url()).searchParams.get('status')).toBe('done');
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    const chip = page.getByRole('button', { name: 'Status: Done, clear filter', exact: true });
    await expect(chip).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter 1', exact: true })).toBeVisible();
    await selectThread(page, comments[0]!.number);
    await bar.getByRole('checkbox', { name: 'Select shown results', exact: true }).check();
    await expect(bar.getByText('1 selected', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await chip.click();
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe(`/app/projects/${project}`);
});

test('board cards are darker than their column on dark', async ({ page, request }) => {
    const { column, card } = await board(page, request);
    // On dark the card is the page's black, a step darker than its column
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    const surface = (target: Locator) => target.evaluate(element => getComputedStyle(element).backgroundColor);
    const row = card('Open', 'First board thread').locator('[data-comment-row]');
    await expect.poll(() => surface(row)).toBe('rgb(0, 0, 0)');
    expect(await surface(column('Open'))).not.toBe('rgb(0, 0, 0)');
});

test('a card starts its title with its author\'s avatar, keeps its selection box under it hidden at rest without moving, and an empty column centres its line', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Hover; a touch screen selects with a long press');
    const { column, card } = await board(page, request);
    const first = card('Open', 'First board thread');
    // The author is an avatar named for assistive tech, with the name in a tooltip, not a line of text
    const author = first.getByRole('img', { name: 'By Reviewer', exact: true });
    await expect(author).toBeVisible();
    await expect(first).not.toContainText('Reviewer');
    await author.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Reviewer');
    // The author starts the title line, before the number
    const [authorBox, link] = [(await author.boundingBox())!, (await first.getByRole('link').boundingBox())!];
    expect(authorBox.x + authorBox.width).toBeLessThanOrEqual(link.x);
    expect(authorBox.y).toBeLessThan(link.y + 20);
    // The page path starts the second line under "#12 …"
    const meta = (await first.locator('[data-comment-row] p').first().boundingBox())!;
    expect(meta.x).toBeCloseTo(link.x, 0);
    // The box is hidden until the card is hovered, under the author at the start of that line, and keeps its room so nothing moves
    const box = first.getByRole('checkbox');
    await page.mouse.move(0, 0);
    await expect(box).toHaveCSS('opacity', '0');
    const atRest = (await box.boundingBox())!;
    await first.hover();
    await expect(box).toHaveCSS('opacity', '1');
    expect((await box.boundingBox())!.x).toBe(atRest.x);
    const [cardBox, checkbox] = [(await first.boundingBox())!, (await box.boundingBox())!];
    expect(checkbox.x + checkbox.width / 2).toBeCloseTo(authorBox.x + authorBox.width / 2, 0);
    expect(checkbox.y).toBeGreaterThan(authorBox.y + authorBox.height);
    expect(checkbox.x + checkbox.width).toBeLessThan(meta.x);
    expect(cardBox.y + cardBox.height - (checkbox.y + checkbox.height)).toBeLessThan(24);
    // An empty column's line is in the middle of the room below the column's name
    const empty = await column('Done').locator('[data-empty-column]').evaluate(line => {
        const range = document.createRange();
        range.selectNodeContents(line);
        const text = range.getBoundingClientRect(), room = line.getBoundingClientRect();
        const section = line.closest('section')!, style = getComputedStyle(section);
        const end = section.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
        return { offCentre: Math.abs((text.top + text.bottom) / 2 - (room.top + room.bottom) / 2), below: end - room.bottom, room: room.height - text.height };
    });
    // The line fills the column to its end and its words sit in the middle
    expect(empty.below).toBeLessThan(1);
    expect(empty.room).toBeGreaterThan(20);
    expect(empty.offCentre).toBeLessThan(1);
});

// uier #201: the sheet is a flex column and the card clips, so the card shrank to the sheet and hid what was below
test('a long thread scrolls in the board\'s sheet on a short window, down to Reply', async ({ page, request }, testInfo) => {
    const { project, headers, comments, card } = await board(page, request);
    if (!testInfo.project.name.startsWith('Mobile')) await page.setViewportSize({ width: 1366, height: 520 });
    const words = 'This reply is long on purpose, so the thread runs well past the bottom of a short window. ';
    for (let index = 1; index <= 6; index++) {
        const response = await request.post(`/api/review/${project}/comments/${comments[0]!.id}/replies`, { headers, data: { text: `Reply ${index}. ${words.repeat(4)}`, authorName: 'Reviewer' } });
        expect(response.ok()).toBe(true);
    }
    await page.reload();
    await card('Open', 'First board thread').getByRole('link').click();
    const sheet = page.getByRole('dialog');
    const thread = sheet.getByRole('article');
    await expect(thread.getByText('Reply 6.')).toBeAttached();
    await animationsFinished(sheet);
    // The card keeps its full height and the sheet scrolls it
    const [sheetBox, threadBox] = [(await sheet.boundingBox())!, (await thread.boundingBox())!];
    expect(threadBox.height).toBeGreaterThan(sheetBox.height);
    const reply = thread.getByRole('button', { name: 'Reply', exact: true });
    await expect(reply).not.toBeInViewport();
    await page.mouse.move(sheetBox.x + sheetBox.width / 2, sheetBox.y + sheetBox.height / 2);
    for (let step = 0; step < 20 && !(await reply.evaluate(button => {
        const box = button.getBoundingClientRect();
        return box.bottom <= window.innerHeight && box.top >= 0;
    })); step++) await page.mouse.wheel(0, 400);
    await expect(reply).toBeInViewport();
    expect(await sheet.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('on a phone the board keeps its columns in one row that scrolls sideways, the next one peeking in', async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Mobile'), 'The phone layout');
    const { column } = await board(page, request);
    const width = page.viewportSize()!.width;
    const open = (await column('Open').boundingBox())!;
    const inProgress = (await column('In progress').boundingBox())!;
    const done = (await column('Done').boundingBox())!;
    expect(inProgress.y).toBeCloseTo(open.y, 0);
    expect(done.width).toBeCloseTo(open.width, 0);
    // Near the phone's width, lined up with the page, and the next column starts on screen
    expect(open.x).toBeCloseTo(16, 0);
    expect(open.width).toBeGreaterThan(width * 0.6);
    expect(inProgress.x).toBeLessThan(width);
    // The board scrolls sideways (a swipe), the page does not
    const grid = page.locator('[data-board-scroll]');
    expect(await grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('the List/Board choice is remembered and kept in the address; a view in the address wins', async ({ page, request }) => {
    const { project, column } = await board(page, request);
    const list = page.getByRole('list', { name: 'Comments', exact: true });
    const view = () => new URL(page.url()).searchParams.get('view');

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(list).toBeVisible();
    expect(view()).toBe('list');
    // Opened again without a view: the remembered one, written to the address
    await page.goto(`/app/projects/${project}`);
    await expect.poll(view).toBe('list');
    await expect(list).toBeVisible();

    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect.poll(view).toBe('board');
    await page.goto(`/app/projects/${project}`);
    await expect.poll(view).toBe('board');
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);

    // A link's view wins and is not remembered
    await page.goto(`/app/projects/${project}?view=list`);
    await expect(list).toBeVisible();
    await page.goto(`/app/projects/${project}`);
    await expect.poll(view).toBe('board');

    // Without the cookie the server paints the list, never a loading state; an older localStorage-only Board choice
    // then switches once after hydration and moves into the cookie
    await page.context().clearCookies({ name: /uier_comments_view$/ });
    let release!: () => void;
    const hydration = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/_next/static/**/*.js', async route => { await hydration; await route.continue(); });
    try {
        await page.goto(`/app/projects/${project}`, { waitUntil: 'commit' });
        await expect(list).toBeVisible();
        await expect(page.locator('#comments').getByRole('status', { name: 'Loading project', exact: true })).toHaveCount(0);
    } finally { release(); }
    await page.waitForLoadState('load');
    await page.unroute('**/_next/static/**/*.js');
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect.poll(view).toBe('board');
    await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name.endsWith('uier_comments_view'))?.value).toBe('board');

    // The request-readable cookie still remembers the view when localStorage is blocked.
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    await page.goto(`/app/projects/${project}`);
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect.poll(view).toBe('board');
    // With neither store available there is no memory; choosing a view still works in the address.
    await page.context().clearCookies({ name: /uier_comments_view$/ });
    await page.goto(`/app/projects/${project}`);
    await expect(list).toBeVisible();
    expect(view()).toBeNull();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect.poll(view).toBe('board');
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
});

test('board cards drag with the mouse between the columns they can move to', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The mouse; touch screens have their own test');
    // Every column on screen: the drop points are measured before the drag, and a board that scrolls sideways
    // would auto-scroll them away at its edge
    await page.setViewportSize({ width: 1674, height: 900 });
    const { column, card } = await board(page, request);
    // The card shows it can be picked up
    await card('Open', 'Second board thread').hover();
    await expect.poll(() => card('Open', 'Second board thread').getByRole('link').evaluate(link => getComputedStyle(link).cursor)).toBe('grab');

    // Lifted: the card stays behind faded, the columns it can go to are marked, the one under it shows where it lands
    const height = (await card('Open', 'Second board thread').boundingBox())!.height;
    await dragWithMouse(page, card('Open', 'Second board thread'), column('Done'), { drop: false });
    await expect(column('Open')).toHaveAttribute('data-drop', 'home');
    await expect(column('In progress')).toHaveAttribute('data-drop', 'target');
    await expect(column('In progress')).toContainText('Drop here.');
    await expect(column('Ready to verify')).toHaveAttribute('data-drop', 'target');
    await expect(column('Ready to verify')).toContainText('Drop here.');
    await expect(column('Done')).toHaveAttribute('data-drop', 'over');
    // Archive takes no drop: it is dimmed
    await expect(column('Archived')).toHaveAttribute('data-drop', 'refused');
    await expect(placeholder(column('Done'))).toHaveCount(1);
    expect(Math.round((await placeholder(column('Done')).boundingBox())!.height)).toBe(Math.round(height));
    await expect(dragPreview(page)).toContainText('Second board thread');
    await page.mouse.up();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(dragPreview(page)).toHaveCount(0);
    await expect(page.locator('section[data-drop]')).toHaveCount(0);
    // Dropping does not open the thread
    await expect(page.getByRole('article')).toHaveCount(0);

    // Escape puts the card back
    await dragWithMouse(page, card('Done', 'Second board thread'), column('Open'), { drop: false });
    await expect(column('Open')).toHaveAttribute('data-drop', 'over');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: /stays in Done/ })).toBeAttached();

    // Back to Open: Reopen. The card lands in the list's order (priority, then number, highest first), below the newer thread.
    await dragWithMouse(page, card('Done', 'Second board thread'), column('Open'));
    await expect(column('Open').getByRole('listitem')).toHaveText([/Second board thread/, /First board thread/]);
    await page.reload();
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);

    // Dropped on Ready to verify: the request form opens; the card moves once it is sent
    await dragWithMouse(page, card('Open', 'First board thread'), column('Ready to verify'));
    const thread = page.getByRole('article');
    await thread.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Dragged to Ready to verify');
    await thread.getByRole('form', { name: 'Request verification' }).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    // Back to Open cancels the check
    await dragWithMouse(page, card('Ready to verify', 'First board thread'), column('Open'));
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('Verification request canceled.', { exact: true })).toBeVisible();
    // The card opens its thread from the board too
    await expect(await openComment(page, 'Second board thread')).toHaveAccessibleName('Comment by Reviewer');
});

test('In progress is a column between Open and Ready to verify; cards move in and out of it', async ({ page, request }, testInfo) => {
    const { comments, column, card } = await board(page, request);
    await expect(page.getByRole('region', { name: /comments$/ })).toHaveText([/^Open/, /^In progress/, /^Ready to verify/, /^Done/, /^Archive/]);
    await expect(column('In progress')).toContainText('Nothing in progress.');

    // Move from the keyboard
    await openBoardMove(page, comments[0]!.number, column('Open'));
    await page.getByRole('menuitem', { name: 'In progress', exact: true }).click();
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(column('In progress').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: `Comment #${comments[0]!.number} moved to In progress.` })).toBeAttached();
    await page.reload();
    await expect(card('In progress', 'First board thread')).toBeVisible();
    // A card leaves its status to the column, in every column
    await expect(page.getByRole('region', { name: /comments$/ }).getByRole('listitem').getByText(/^Status: /)).toHaveCount(0);
    await expect(card('In progress', 'First board thread')).not.toContainText('In progress');

    // Its thread says so, and its menu takes it back
    await card('In progress', 'First board thread').getByRole('link').click();
    const thread = page.getByRole('article');
    await thread.getByRole('button', { name: 'Status: In progress. Change status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('In progress').getByRole('listitem')).toHaveCount(0);
    await expect(card('Done', 'First board thread')).not.toContainText('Done');

    if (!testInfo.project.name.startsWith('Mobile')) {
        // Dragged from Done to In progress, then back to Open, on a window where all four columns fit (narrower,
        // the board scrolls sideways and Done starts out of view)
        await page.setViewportSize({ width: 1674, height: 900 });
        await dragWithMouse(page, card('Done', 'First board thread'), column('In progress'));
        await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
        await dragWithMouse(page, card('In progress', 'First board thread'), column('Open'));
        await expect(column('Open').getByRole('listitem')).toHaveCount(2);
        await expect(column('In progress').getByRole('listitem')).toHaveCount(0);
    }

    // The list's status tabs: In progress is part of Active and has its own tab
    await openBoardMove(page, comments[1]!.number, column('Open'));
    await page.getByRole('menuitem', { name: 'In progress', exact: true }).click();
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const tabs = page.getByRole('group', { name: 'Status', exact: true });
    await expect(tabs.locator('[aria-pressed]')).toHaveText([/^Active \d+$/, /^Done \d+$/, /^All \d+$/]);
    await chooseActiveStatus(page, /^In progress \d+$/);
    await expect(page).toHaveURL(/status=in-progress/);
    const row = page.locator('[data-comment-id]').filter({ hasText: 'Second board thread' });
    await expect(row).toBeVisible();
    await expect(page.getByRole('link', { name: /First board thread/ })).toHaveCount(0);
    // The row says its status
    await expect(row).toContainText('In progress');
});

/** Opens the menu folded under the Active tab and picks one of its statuses */
async function chooseActiveStatus(page: Page, name: string | RegExp) {
    await page.getByRole('group', { name: 'Status', exact: true }).getByRole('button', { name: 'Active statuses', exact: true }).click();
    const menu = page.getByRole('menu');
    await animationsFinished(menu);
    await menu.getByRole('menuitemradio', { name, exact: typeof name === 'string' }).click();
    await expect(menu).toHaveCount(0);
}

test('the list shows Active by default, every status but Done, and each row says its status', async ({ page, request }) => {
    const { project, comments, column } = await board(page, request);
    const response = await request.post(`/api/review/${project}/comments`, { headers: await verifiedReviewHeaders(request, project, site.origin()), data: {
        path: `/${project}/pricing`, text: 'Third board thread', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    await page.reload();
    const move = async (number: number, to: string) => {
        await openBoardMove(page, number);
        await page.getByRole('menuitem', { name: to, exact: true }).click();
        await expect(column(to).getByRole('listitem').filter({ hasText: `#${number}` })).toHaveCount(1);
    };
    await move(comments[0]!.number, 'In progress');
    await move(comments[1]!.number, 'Done');

    // No `?status=`: Active, with Open and In progress threads but not the Done one. Active, Done and All are the tabs;
    // Open, In progress and Ready to verify fold under Active
    await page.goto(`/app/projects/${project}`);
    const tabs = page.getByRole('group', { name: 'Status', exact: true });
    const toggles = tabs.locator('[aria-pressed]');
    await expect(toggles).toHaveText([/^Active 2$/, /^Done 1$/, /^All 3$/]);
    await expect(tabs.getByRole('button', { name: 'Active 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const rows = page.locator('[data-comment-id]');
    const row = (text: string) => rows.filter({ hasText: text });
    await expect(rows).toHaveCount(2);
    await expect(row('Second board thread')).toHaveCount(0);
    // Every row says its status, Open too, inside the layout
    for (const [text, status] of [['First board thread', 'In progress'], ['Third board thread', 'Open']] as const) {
        const state = row(text).getByText(`Status: ${status}`, { exact: true });
        await expect(state).toBeVisible();
        await expect(state).toBeInViewport({ ratio: 1 });
    }

    // The menu beside Active lists the folded statuses with their counts, Active checked
    const more = tabs.getByRole('button', { name: 'Active statuses', exact: true });
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await more.click();
    const menu = page.getByRole('menu');
    await animationsFinished(menu);
    await expect(menu.getByRole('menuitemradio')).toHaveText([/^Active\s*2$/, /^Open\s*1$/, /^In progress\s*1$/, /^Ready to verify\s*0$/]);
    await expect(menu.getByRole('menuitemradio', { name: 'Active 2', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // One status at a time still filters, stays in the address, and the Active tab names it
    await chooseActiveStatus(page, 'Open 1');
    await expect(page).toHaveURL(/status=open/);
    await expect(tabs.getByRole('button', { name: 'Active: Open 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(1);
    await expect(row('Third board thread')).toHaveCount(1);
    // Pressing the Active tab again goes back to every active status
    await tabs.getByRole('button', { name: 'Active: Open 1', exact: true }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(tabs.getByRole('button', { name: 'Active 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(2);

    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    await expect(page).toHaveURL(/status=done/);
    await expect(tabs.getByRole('button', { name: 'Active 2', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(1);
    await expect(row('Second board thread').getByText('Status: Done', { exact: true })).toBeVisible();
    // From Done straight to a folded status
    await chooseActiveStatus(page, 'Ready to verify 0');
    await expect(page).toHaveURL(/status=ready/);
    await expect(tabs.getByRole('button', { name: 'Active: Ready to verify 0', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(0);
    await tabs.getByRole('button', { name: 'All 3', exact: true }).click();
    await expect(page).toHaveURL(/status=all/);
    await expect(rows).toHaveCount(3);

    // A `?status=` link opens on the folded status
    await page.goto(`/app/projects/${project}?status=in-progress`);
    await expect(tabs.getByRole('button', { name: 'Active: In progress 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(1);
    await expect(row('First board thread')).toHaveCount(1);
    await expectNoAxeViolations(page);
    // From the keyboard: the menu opens from the button beside Active and a status is chosen with Enter
    await more.focus();
    await page.keyboard.press('Enter');
    await animationsFinished(menu);
    await expect(menu.getByRole('menuitemradio', { name: 'In progress 1', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Ready to verify 0', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitemradio', { name: 'Open 1', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/status=open/);
    await expect(tabs.getByRole('button', { name: 'Active: Open 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Back to Active: the address drops `status`
    await chooseActiveStatus(page, 'Active 2');
    await expect(page).not.toHaveURL(/status=/);
    await expect(rows).toHaveCount(2);
});

test('board cards drag to and from In progress; from Ready to verify it cancels the check', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The mouse; touch screens use the same move');
    // Keep all measured drop targets inside the viewport, as in the other mouse-drag journey.
    await page.setViewportSize({ width: 1674, height: 900 });
    const { project, comments, column, card } = await board(page, request);

    // Open to In progress: every other column takes the card
    await dragWithMouse(page, card('Open', 'First board thread'), column('In progress'), { drop: false });
    await expect(column('Open')).toHaveAttribute('data-drop', 'home');
    await expect(column('In progress')).toHaveAttribute('data-drop', 'over');
    await expect(placeholder(column('In progress'))).toHaveCount(1);
    await expect(column('Ready to verify')).toHaveAttribute('data-drop', 'target');
    await expect(column('Done')).toHaveAttribute('data-drop', 'target');
    await page.mouse.up();
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: `Comment #${comments[0]!.number} moved to In progress.` })).toBeAttached();
    await page.reload();
    await expect(card('In progress', 'First board thread')).toBeVisible();

    // In progress to Done
    await dragWithMouse(page, card('In progress', 'First board thread'), column('Done'), { drop: false });
    await expect(column('In progress')).toHaveAttribute('data-drop', 'home');
    await expect(column('Open')).toHaveAttribute('data-drop', 'target');
    await expect(column('Done')).toHaveAttribute('data-drop', 'over');
    await page.mouse.up();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('In progress').getByRole('listitem')).toHaveCount(0);
    await page.reload();
    await expect(card('Done', 'First board thread')).toBeVisible();
    await expect(column('In progress')).toContainText('Nothing in progress.');

    // Ready to verify, then dragged to In progress: the check is canceled and the card stays there
    await dragWithMouse(page, card('Open', 'Second board thread'), column('Ready to verify'));
    const thread = page.getByRole('article');
    await thread.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Dragged to Ready to verify');
    await thread.getByRole('form', { name: 'Request verification' }).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);

    // It moves at once, and goes back when canceling fails
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fail = async (route: Route) => {
        if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.continue();
        await held;
        await route.abort('failed');
    };
    await page.route(`**/app/projects/${project}*`, fail);
    try {
        await dragWithMouse(page, card('Ready to verify', 'Second board thread'), column('In progress'));
        await expect(column('In progress').getByRole('listitem')).toHaveCount(1, { timeout: 2_000 });
        await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(0);
    } finally { release(); }
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    await expect(column('In progress').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('Could not save the change. Try again.', { exact: true })).toBeVisible();
    await page.unroute(`**/app/projects/${project}*`, fail);

    await dragWithMouse(page, card('Ready to verify', 'Second board thread'), column('In progress'));
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('Verification request canceled.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(card('In progress', 'Second board thread')).toBeVisible();
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(0);
    await card('In progress', 'Second board thread').getByRole('link').click();
    await expect(thread.getByRole('button', { name: 'Status: In progress. Change status', exact: true })).toBeVisible();
});

test('a column the card cannot move to refuses it', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The mouse; touch screens have their own test');
    // With comments off, nobody can request a verification: Ready to verify takes no card
    const { comments, column, card } = await board(page, request, { access: 'Comments off' });
    await dragWithMouse(page, card('Open', 'First board thread'), column('Ready to verify'), { drop: false });
    await expect(column('Ready to verify')).toHaveAttribute('data-drop', 'refused');
    await expect(column('Ready to verify')).toContainText('No checks requested.');
    await expect(placeholder(column('Ready to verify'))).toHaveCount(0);
    await expect(column('In progress')).toHaveAttribute('data-drop', 'target');
    await expect(column('Done')).toHaveAttribute('data-drop', 'target');
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: `Comment #${comments[0]!.number} can't move to Ready to verify. It stays in Open.` })).toBeAttached();
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
    // Move offers the same choices
    await openBoardMove(page, comments[0]!.number, column('Open'));
    await expect(page.getByRole('menuitem', { name: 'Ready to verify', exact: true })).toBeDisabled();
});

test('board cards move when held and moved on a touch screen; a long press held still selects the card', async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Mobile'), 'Touch screens');
    const { comments, column, card } = await board(page, request);
    // A long press held still selects the card (uier #179): it lifts nothing and opens nothing, and the card stays
    const second = card('Open', 'Second board thread');
    const box = second.getByRole('checkbox');
    await longPress(page, second.getByRole('link'), async () => {
        await expect(box).toBeChecked();
        await expect(second).not.toHaveAttribute('data-hold');
    });
    await expect(dragPreview(page)).toHaveCount(0);
    await expect(selectionBar(page).getByText('1 selected', { exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await selectionBar(page).getByRole('button', { name: 'Clear selection', exact: true }).tap();
    await expect(selectionBar(page)).toHaveCount(0);
    // No Move on a card: held then moved it drags, a tap opens the thread and its status menu
    await expect.poll(() => moveShown(column('Open').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true }))).toBe(false);
    // In progress is the column beside Open, peeking in at the phone's edge
    await dragWithTouch(page, card('Open', 'First board thread'), column('In progress'));
    await expect(column('In progress').getByRole('listitem')).toHaveCount(1);
    await expect(dragPreview(page)).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
    await page.reload();
    await expect(column('In progress').getByRole('listitem').filter({ hasText: 'First board thread' })).toBeVisible();
    // A tap still opens the thread
    await card('Open', 'Second board thread').getByRole('link').tap();
    await expect(page.getByRole('article')).toHaveAccessibleName('Comment by Reviewer');
});

test('a dropped card shows in its new column at once and goes back when saving fails', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The mouse; touch screens use the same move');
    const { project, column, card } = await board(page, request);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/app/projects/${project}*`, async route => {
        if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.continue();
        await held;
        await route.abort('failed');
    });
    try {
        await dragWithMouse(page, card('Open', 'First board thread'), column('Done'));
        await expect(column('Done').getByRole('listitem')).toHaveCount(1, { timeout: 2_000 });
        await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    } finally { release(); }
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect(column('Done').getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('Could not save the change. Try again.', { exact: true })).toBeVisible();
});
