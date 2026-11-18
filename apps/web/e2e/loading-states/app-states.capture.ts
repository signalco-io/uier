import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from '../support/app';
import { verifiedReviewHeaders } from '../support/reviewVerification';
import { startReviewedSite } from '../support/reviewedSite';
import { Capture, settled, type Entry } from './capture';

// Loading states inside a loaded app page: a request is held open while the page shows what it shows meanwhile.

/** Holds matching requests until `release()`; `seen()` resolves once one is held */
async function hold(page: Page, url: string | RegExp, match: (route: Route) => boolean = () => true) {
    const held: Route[] = [];
    let notify: (() => void) | undefined;
    const handler = async (route: Route) => {
        if (!match(route)) return route.fallback();
        held.push(route); notify?.();
    };
    await page.route(url, handler);
    return {
        seen: () => held.length ? Promise.resolve() : new Promise<void>(resolve => { notify = resolve; }),
        async release() {
            await page.unroute(url, handler);
            await Promise.all(held.map(route => route.continue().catch(() => {})));
        }
    };
}

/** A server action's request: a POST to the page with Next's action header */
const serverAction = (route: Route) => route.request().method() === 'POST' && Boolean(route.request().headers()['next-action']);

test('app in-page states', async ({ page, request, baseURL }, info) => {
    const capture = new Capture(info, 'app-states');
    const mobile = info.project.name === 'mobile';
    const site = await startReviewedSite(new URL(baseURL!).origin);
    const group = 'Inside a loaded page';
    /** A viewport capture, or one cropped around `around` so a small state is legible */
    const record = async (entry: Omit<Entry, 'viewport' | 'file' | 'statuses' | 'skeletons' | 'surface' | 'group' | 'trigger'>, around?: Locator, pad = 32) => {
        const recorded = await capture.record(page, { ...entry, surface: 'app', group, trigger: 'in-page' });
        if (!around) return recorded;
        const box = await around.boundingBox();
        const viewport = page.viewportSize()!;
        if (!box) return recorded;
        const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
        const clip = { x, y, width: Math.min(viewport.width - x, box.width + pad * 2), height: Math.min(viewport.height - y, box.height + pad * 2) };
        const { join } = await import('node:path');
        await page.screenshot({ path: join(capture.dir, `${entry.id}.png`), clip, animations: 'disabled', caret: 'hide' });
        return recorded;
    };
    /** One state: a failure is reported and the next state is still captured */
    const step = async (title: string, run: () => Promise<void>) => {
        try { await run(); } catch (error) {
            console.warn(`[capture] ${title} failed: ${String(error).split('\n').slice(0, 4).join(' | ')}`);
            await page.screenshot({ path: `test-results/debug-${info.project.name}-${title.replace(/[^a-z]+/gi, '-').slice(0, 40)}.png` }).catch(() => {});
            await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
    };
    let gate!: Awaited<ReturnType<typeof hold>>;
    try {
        await signIn(page, uniqueEmail('loading-states'));
        const shop = await createProject(page, { urls: [site.origin()], name: 'Shop', clientName: 'Acme' });
        await setProjectAccess(page, shop, 'Anyone with the link');
        // A visitor may post ten comments in a row: a new one for every ten
        let headers = await verifiedReviewHeaders(request, shop, site.origin());
        // A screenshot of a realistic size, drawn in the page
        const screenshot = await page.evaluate(() => {
            const canvas = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#e8ecf3'; context.fillRect(0, 0, 960, 540);
            context.fillStyle = '#c3cbd9'; context.fillRect(60, 60, 840, 90); context.fillRect(60, 190, 400, 290); context.fillRect(500, 190, 400, 130);
            return canvas.toDataURL('image/png');
        });
        const post = async (data: Record<string, unknown>) => {
            const response = await request.post(`/api/review/${shop}/comments`, { headers, data: { authorName: 'Guest reviewer', position: { type: 'page' }, kind: 'feedback', ...data } });
            expect(response.status(), await response.text()).toBe(201);
            return await response.json() as { id: string };
        };
        for (let index = 0; index < 34; index++) {
            if (index % 8 === 7) headers = await verifiedReviewHeaders(request, shop, site.origin());
            await post({ path: `/${shop}/${index % 3 ? 'pricing' : 'checkout'}`, text: `Feedback ${index + 1}: the spacing under the heading is off on this page` });
        }
        headers = await verifiedReviewHeaders(request, shop, site.origin());
        // The newest thread opens first: long text, a screenshot and replies, so its shell has every placeholder
        const rich = await post({ path: `/${shop}/checkout`, screenshot,
            text: `Checkout total is wrong. ${'The sum under the cart does not include shipping until the page is reloaded. '.repeat(8)}\n\nSteps: add two items, change the country, look at the total.` });
        for (const text of ['I can reproduce this on Safari too.', `Same here. ${'It also happens after applying a discount code. '.repeat(4)}`]) {
            const response = await request.post(`/api/review/${shop}/comments/${rich.id}/replies`, { headers, data: { text, authorName: 'Second reviewer' } });
            expect(response.status(), await response.text()).toBe(201);
        }
        const docs = await createProject(page, { urls: ['https://docs.example.com'], name: 'Docs site', clientName: 'Acme' });
        const project = `/app/projects/${shop}`;
        const detail = new RegExp(`/api/projects/${shop}/comments/comment_[^/?]+$`);

        await step('A thread while its detail loads (CommentCardShell)', async () => {
            gate = await hold(page, detail);
            await page.goto(project);
            if (mobile) {
                const row = page.getByRole('link', { name: /^Comment #35/ }).first();
                await hydrated(row); await row.click();
            }
            await gate.seen();
            const shell = page.locator('[data-thread-shell="loading"]').filter({ visible: true });
            await expect(shell).toBeVisible();
            await page.waitForTimeout(300);
            const thread = await record({ id: 'state-thread-shell-list', title: 'Thread opening in the list (CommentCardShell)', route: project,
                note: 'The row summary is drawn for real; the selector, device, rest of the text, screenshot and replies pulse.' });
            await gate.release();
            await expect(page.getByRole('article').filter({ visible: true })).toBeVisible();
            await settled(page);
            thread.loaded = await capture.shot(page, 'state-thread-shell-list--loaded');
        });

        await step('A screenshot still downloading (MessageImage)', async () => {
            gate = await hold(page, /\/screenshot(\?|$)/);
            await page.goto(project);
            if (mobile) {
                const row = page.getByRole('link', { name: /^Comment #35/ }).first();
                await hydrated(row); await row.click();
            }
            const placeholder = page.locator('[data-image-placeholder]').filter({ visible: true }).first();
            await expect(placeholder).toBeVisible();
            await placeholder.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await record({ id: 'state-thread-image', title: 'Screenshot downloading in a thread (MessageImage)', route: project,
                note: 'A pulsing box at the screenshot\'s final size.' }, placeholder, 80);
            await gate.release();
        });

        await step("The thread in the board's sheet", async () => {
            await page.goto(`${project}?view=board`);
            await settled(page);
            gate = await hold(page, detail);
            const card = page.getByRole('link', { name: /^Comment #35/ }).filter({ visible: true }).first();
            await hydrated(card); await card.click();
            await gate.seen();
            await expect(page.locator('[data-thread-shell="loading"]').filter({ visible: true })).toBeVisible();
            await page.waitForTimeout(500);
            const sheet = await record({ id: 'state-thread-shell-board', title: 'Thread opening on the board (sheet)', route: `${project}?view=board` });
            await gate.release();
            await settled(page);
            sheet.loaded = await capture.shot(page, 'state-thread-shell-board--loaded');
            await page.keyboard.press('Escape');
        });

        await step('The next page of a board column', async () => {
            gate = await hold(page, new RegExp(`/api/projects/${shop}/comments/pages$`));
            const column = page.getByRole('region', { name: 'Open comments', exact: true });
            await column.locator('[data-comment-window]').evaluate(element => element.lastElementChild?.scrollIntoView({ block: 'end' }));
            await gate.seen();
            await page.waitForTimeout(300);
            await column.getByRole('heading').scrollIntoViewIfNeeded();
            await record({ id: 'state-board-column-more', title: 'Board column loading its next page', route: `${project}?view=board`,
                note: 'A 12 px spinner at the right end of the column header; Load more is disabled at the column\'s end.' }, column.getByRole('heading').locator('xpath=..'), 24);
            await column.locator('[data-comment-window]').evaluate(element => element.lastElementChild?.scrollIntoView({ block: 'end' }));
            await page.waitForTimeout(200);
            // The outlines of the cards on their way, above the button
            const nextCards = column.locator('[data-next-page]');
            await nextCards.scrollIntoViewIfNeeded().catch(() => {});
            await record({ id: 'state-board-load-more', title: 'Load more at the end of a board column', route: `${project}?view=board` },
                await nextCards.count() ? nextCards : column.getByRole('button', { name: 'Load more', exact: true }), 72);
            await gate.release();
        });

        await step('The next page of the list', async () => {
            await page.goto(project);
            await settled(page);
            gate = await hold(page, new RegExp(`/api/projects/${shop}/comments/pages$`));
            const more = page.getByRole('button', { name: 'Load more', exact: true }).filter({ visible: true }).first();
            await more.scrollIntoViewIfNeeded();
            await gate.seen();
            await page.waitForTimeout(300);
            await more.scrollIntoViewIfNeeded();
            const nextRows = page.locator('[data-next-page]').filter({ visible: true }).first();
            await record({ id: 'state-list-load-more', title: 'List loading its next page (Load more)', route: project,
                note: 'Row outlines stand for the rows on their way, above the disabled button.' },
                await nextRows.count() ? nextRows : more, await nextRows.count() ? 72 : 120);
            await gate.release();
        });

        await step('Header popovers: counts and people load when they open', async () => {
            await page.goto(project);
            await settled(page);
            gate = await hold(page, '**/app/projects/**', serverAction);
            const client = page.getByRole('link', { name: 'Client: Acme' }).filter({ visible: true }).first();
            await hydrated(client);
            if (mobile) await client.tap(); else await client.hover();
            const clientPopover = page.locator('[role="dialog"][aria-label="Client: Acme"]');
            await expect(clientPopover).toBeVisible();
            await gate.seen();
            await page.waitForTimeout(400);
            await record({ id: 'state-client-popover', title: 'Client popover: project counts loading', route: project,
                note: 'One 16 px skeleton line where the counts go; the popover keeps its size.' }, clientPopover, 60);
            await gate.release();

            await page.goto(`/app/projects/${docs}`);
            await settled(page);
            gate = await hold(page, '**/app/projects/**', serverAction);
            const access = page.getByRole('link', { name: 'Invited people', exact: true }).filter({ visible: true }).first();
            await hydrated(access);
            if (mobile) await access.tap(); else await access.hover();
            const accessPopover = page.locator('[role="dialog"][aria-label="Invited people"]');
            await expect(accessPopover).toBeVisible();
            await gate.seen();
            await page.waitForTimeout(400);
            await record({ id: 'state-access-popover', title: 'Who can comment popover: people loading', route: `/app/projects/${docs}`,
                note: 'Three avatar circles and a line, at the loaded row\'s height.' }, accessPopover, 60);
            await gate.release();
        });

        await step('A form saving: the pending button every form shares', async () => {
            await page.goto(`${project}/settings`);
            await settled(page);
            const name = page.getByLabel('Project name', { exact: true });
            await hydrated(name);
            await name.fill('Shop website');
            gate = await hold(page, '**/app/projects/**', serverAction);
            const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();
            await save.click();
            await gate.seen();
            await page.waitForTimeout(300);
            await record({ id: 'state-form-saving', title: 'A settings form saving (pending button)', route: `${project}/settings`,
                note: 'The pattern of every form: the submit button is disabled with a spinner before its label.' }, save, 90);
            await gate.release();
        });

        await step('Installation check running', async () => {
            await page.goto(`${project}/settings/installation`);
            await settled(page);
            const check = page.getByRole('button', { name: /^(Check installation|Retry installation check)$/ }).filter({ visible: true }).first();
            if (await check.count()) {
                await hydrated(check);
                const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => undefined), check.click()]);
                const result = page.getByRole('status', { name: 'Installation result', exact: true });
                if (await result.isVisible().catch(() => false) && await result.getAttribute('data-result') === 'checking') {
                    await record({ id: 'state-installation-check', title: 'Installation check running', route: `${project}/settings/installation`,
                        note: 'A spinner in the button, Cancel check beside it and a line saying what it waits for.' }, result.locator('xpath=..'), 40);
                }
                await popup?.close().catch(() => {});
            }
        });
    } finally {
        capture.save();
        await site.close();
    }
});
