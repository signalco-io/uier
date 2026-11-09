import { expect, test, type APIRequestContext, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { commentRows, createProject, openBoardMove, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// Cards and rows that arrive, leave or change place animate (`LayoutMotion`). These tests never time the
// motion: they watch for the marks it leaves (`data-motion` on an item while it moves, a leaving copy with
// `data-motion="exit"`) and check where everything ends.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

type Motions = { motions: string[] };

/**
 * From the page's first paint, every motion as `enter:<id>`, `move:<id>` or `exit:<id>` (ids from
 * `data-board-card` or `data-comment-id`), for `motions()` to read and `forget()` to clear.
 */
async function watchMotion(page: Page) {
    await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as Motions).motions = seen;
        new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') {
                    const element = record.target as HTMLElement;
                    const id = element.dataset.boardCard ?? element.dataset.commentId;
                    if (element.dataset.motion && id) seen.push(`${element.dataset.motion}:${id}`);
                } else {
                    for (const node of record.addedNodes)
                        if (node instanceof HTMLElement && node.dataset.motion === 'exit') seen.push(`exit:${node.dataset.motionFor}`);
                }
            }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-motion'] });
    });
    const motions = () => page.evaluate(() => [...new Set((window as unknown as Motions).motions)]);
    return {
        motions,
        forget: () => page.evaluate(() => { (window as unknown as Motions).motions.length = 0; }),
        /** Everything has reached its place: no item is moving and no copy is fading out */
        settled: () => expect(page.locator('[data-motion]')).toHaveCount(0)
    };
}

/** Only Vercel's upgrade boundary is substituted (as in `realtime.spec.ts`); refetches use the real app */
async function realtime(page: Page) {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket('**/api/realtime', socket => {
        socket.onMessage(() => {
            sockets.push(socket);
            socket.send('{"type":"ready"}');
        });
    });
    return {
        connected: () => expect.poll(() => sockets.length).toBeGreaterThan(0),
        /** Another person changed something: the page refreshes its comments */
        changed: () => sockets.at(-1)!.send('{"type":"comments.changed"}')
    };
}

async function project(page: Page, request: APIRequestContext, texts: string[]) {
    await signIn(page, uniqueEmail('motion'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const post = async (text: string) => {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        return await response.json() as { id: string; number: number };
    };
    const comments: { id: string; number: number }[] = [];
    for (const text of texts) comments.push(await post(text));
    return { project, headers, comments, post };
}

const columns = (page: Page) => {
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    const card = (name: string, text: string) => column(name).getByRole('listitem').filter({ hasText: text });
    return { column, card };
};

/** Presses a card and moves the mouse in steps, as a person does (`comment-board.spec.ts`) */
async function dragWithMouse(page: Page, card: Locator, target: Locator) {
    const preview = page.locator('[data-drag-preview]');
    await expect(preview).toHaveCount(0);
    const from = (await card.boundingBox())!;
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await expect(preview).toBeVisible();
    const to = (await target.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 10 });
    await expect(target).toHaveAttribute('data-drop', 'over');
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
}

test('board cards travel to a new column, arrive and leave; nothing moves on load or when the view switches', async ({ page, request }, testInfo) => {
    const { project: id, comments, post } = await project(page, request, ['First motion thread', 'Second motion thread', 'Third motion thread']);
    const watch = await watchMotion(page);
    const socket = await realtime(page);
    const { column, card } = columns(page);
    await page.goto(`/app/projects/${id}?view=board`);
    await expect(column('Open').getByRole('listitem')).toHaveCount(3);
    await socket.connected();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(commentRows(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(column('Open').getByRole('listitem')).toHaveCount(3);
    expect(await watch.motions()).toEqual([]);

    // The thread's status menu: the card travels to Done, and the cards below it in Open slide up
    await card('Open', 'Second motion thread').getByRole('link').click();
    const thread = page.getByRole('article');
    await thread.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Done. Change status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card('Done', 'Second motion thread')).toBeVisible();
    await expect(column('Open').getByRole('listitem')).toHaveText([/Third motion thread/, /First motion thread/]);
    expect(await watch.motions()).toEqual(expect.arrayContaining([`move:${comments[1]!.id}`, `move:${comments[0]!.id}`]));
    await watch.settled();

    // Another reviewer's new thread arrives
    await watch.forget();
    const arrived = await post('Fourth motion thread');
    socket.changed();
    await expect(column('Open').getByRole('listitem')).toHaveText([/Fourth motion thread/, /Third motion thread/, /First motion thread/]);
    expect(await watch.motions()).toEqual(expect.arrayContaining([`enter:${arrived.id}`]));
    await watch.settled();

    // A search that no longer matches a card fades it out where it was; clearing it brings the card back
    await watch.forget();
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    await search.fill('First motion');
    await expect(page.getByRole('region', { name: /comments$/ }).getByRole('listitem')).toHaveText([/First motion thread/]);
    expect(await watch.motions()).toEqual(expect.arrayContaining([`exit:${arrived.id}`, `exit:${comments[2]!.id}`, `exit:${comments[1]!.id}`]));
    await watch.settled();
    await search.fill('');
    await expect(column('Open').getByRole('listitem')).toHaveCount(3);
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    expect(await watch.motions()).toEqual(expect.arrayContaining([`enter:${arrived.id}`, `enter:${comments[1]!.id}`]));
    await watch.settled();

    if (!testInfo.project.name.startsWith('Mobile')) {
        // The dropped card settles from where it was dropped (dnd-kit) and does not travel a second time
        await watch.forget();
        await dragWithMouse(page, card('Open', 'Third motion thread'), column('In progress'));
        await expect(card('In progress', 'Third motion thread')).toBeVisible();
        await watch.settled();
        expect(await watch.motions()).not.toContain(`move:${comments[2]!.id}`);
    }
});

test('a card another person moves keeps the keyboard focus, and nothing scrolls', async ({ page, request }) => {
    const { project: id, headers, comments } = await project(page, request, ['Focus motion thread', 'Other motion thread']);
    const socket = await realtime(page);
    const { column } = columns(page);
    await page.goto(`/app/projects/${id}?view=board`);
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await socket.connected();
    const link = page.getByRole('link', { name: new RegExp(`^Comment #${comments[0]!.number} `) });
    await link.focus();
    const scroll = () => page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.scrollTop > 0).map(element => element.scrollTop));
    const before = await scroll();

    const resolved = await request.patch(`/api/review/${id}/comments/${comments[0]!.id}`, { headers, data: { resolved: true } });
    expect(resolved.status()).toBe(200);
    socket.changed();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Done').getByRole('link', { name: new RegExp(`^Comment #${comments[0]!.number} `) })).toBeFocused();
    expect(await scroll()).toEqual(before);
});

test('list rows arrive, leave and slide to a new priority; many changes at once snap into place', async ({ page, request }) => {
    // Search matches each word on its own; a hyphen never appears in a project's id or the page path
    const words = ['stone-apricot', 'stone-cherry', 'stone-plum', 'banana', 'fig', 'grape', 'lemon', 'mango', 'melon', 'kiwi'];
    const { project: id, comments } = await project(page, request, words.map(word => `Motion thread ${word}`));
    const watch = await watchMotion(page);
    await page.goto(`/app/projects/${id}`);
    await expect(commentRows(page)).toHaveCount(10);
    const search = page.getByRole('searchbox', { name: 'Search feedback' });

    // Nine rows at once: no motion
    await search.fill('kiwi');
    await expect(commentRows(page)).toHaveText([/kiwi/]);
    await search.fill('');
    await expect(commentRows(page)).toHaveCount(10);
    expect(await watch.motions()).toEqual([]);

    // Seven: they fade out, the three that stay slide up; then they come back
    await search.fill('stone-');
    await expect(commentRows(page)).toHaveText([/stone-plum/, /stone-cherry/, /stone-apricot/]);
    const motions = await watch.motions();
    expect(motions.filter(motion => motion.startsWith('exit:'))).toHaveLength(7);
    expect(motions).toEqual(expect.arrayContaining([`exit:${comments[3]!.id}`, `move:${comments[2]!.id}`]));
    await watch.settled();
    await watch.forget();
    await search.fill('');
    await expect(commentRows(page)).toHaveCount(10);
    expect((await watch.motions()).filter(motion => motion.startsWith('enter:'))).toHaveLength(7);
    await watch.settled();

    // A new priority slides the row to its place
    await watch.forget();
    const apricot = comments[0]!;
    await page.getByRole('checkbox', { name: `Select comment #${apricot.number}`, exact: true }).check();
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: 'Urgent', exact: true }).click();
    await expect(commentRows(page).first()).toContainText('stone-apricot');
    expect(await watch.motions()).toEqual(expect.arrayContaining([`move:${apricot.id}`]));
    await watch.settled();
});

test('with reduced motion cards and rows go straight to their places', async ({ page, request }) => {
    const { project: id, comments } = await project(page, request, ['Calm motion thread', 'Still motion thread']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const watch = await watchMotion(page);
    const { column } = columns(page);
    await page.goto(`/app/projects/${id}?view=board`);
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);

    const menu = await openBoardMove(page, comments[0]!.number, column('Open'));
    await menu.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Done').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true })).toBeFocused();
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('Calm');
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('');
    await page.getByRole('group', { name: 'Status', exact: true }).getByRole('button', { name: /^All/ }).click();
    await expect(commentRows(page)).toHaveCount(2);
    expect(await watch.motions()).toEqual([]);
});
