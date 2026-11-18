import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, setProjectAccess, signIn, uniqueEmail } from '../support/app';
import { verifiedReviewHeaders } from '../support/reviewVerification';
import { startReviewedSite } from '../support/reviewedSite';
import { openPageCheck, pageChecksButton, showChecksTab, toolbar } from '../support/toolbar';
import { Capture, type Entry } from './capture';

// The review toolbar's loading states on a project's site: a member opens the site through the app's review link and a
// request is held open while the toolbar shows what it shows meanwhile.

async function hold(page: Page, url: string | RegExp, match: (route: Route) => boolean = () => true) {
    const held: Route[] = [];
    let notify: (() => void) | undefined;
    const handler = async (route: Route) => {
        if (!match(route)) return route.fallback();
        held.push(route); notify?.();
    };
    await page.route(url, handler);
    return {
        count: () => held.length,
        seen: (timeout = 8_000) => held.length ? Promise.resolve(true) : Promise.race([
            new Promise<boolean>(resolve => { notify = () => resolve(true); }),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout))
        ]),
        async release() {
            await page.unroute(url, handler);
            await Promise.all(held.map(route => route.continue().catch(() => {})));
        }
    };
}

/** The content-addressed audit asset among the toolbar's published scripts: the one with axe-core's rules */
const published = new URL('../../public/toolbar/', import.meta.url).pathname;
const auditAsset = readdirSync(published).find(file => file.endsWith('.js') && readFileSync(join(published, file), 'utf8').includes('aria-allowed-attr'))!;

test('toolbar states', async ({ page, request, baseURL }, info) => {
    const capture = new Capture(info, 'toolbar');
    const mobile = info.project.name === 'mobile';
    const site = await startReviewedSite(new URL(baseURL!).origin);
    const group = 'Review toolbar';
    const record = async (entry: Omit<Entry, 'viewport' | 'file' | 'statuses' | 'skeletons' | 'surface' | 'group' | 'trigger'>, around?: Locator, pad = 24) => {
        const recorded = await capture.record(page, { ...entry, surface: 'toolbar', group, trigger: 'in-page' });
        const box = around && await around.boundingBox();
        if (!box) return recorded;
        const viewport = page.viewportSize()!;
        const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
        await page.screenshot({ path: join(capture.dir, `${entry.id}.png`), animations: 'disabled', caret: 'hide',
            clip: { x, y, width: Math.min(viewport.width - x, box.width + pad * 2), height: Math.min(viewport.height - y, box.height + pad * 2) } });
        return recorded;
    };
    const step = async (title: string, run: () => Promise<void>) => {
        try { await run(); } catch (error) {
            console.warn(`[capture] ${title} failed: ${String(error).split('\n').slice(0, 4).join(' | ')}`);
            await page.screenshot({ path: `test-results/debug-toolbar-${info.project.name}-${title.replace(/[^a-z]+/gi, '-').slice(0, 40)}.png` }).catch(() => {});
            await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
    };
    try {
        await signIn(page, uniqueEmail('toolbar-states'));
        const project = await createProject(page, { urls: [site.origin()], name: 'Shop' });
        await setProjectAccess(page, project, 'Anyone with the link');
        const screenshot = await page.evaluate(() => {
            const canvas = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#e8ecf3'; context.fillRect(0, 0, 960, 540);
            context.fillStyle = '#c3cbd9'; context.fillRect(60, 60, 840, 90); context.fillRect(60, 190, 400, 290);
            return canvas.toDataURL('image/png');
        });
        let headers = await verifiedReviewHeaders(request, project, site.origin());
        for (let index = 0; index < 30; index++) {
            if (index % 8 === 7) headers = await verifiedReviewHeaders(request, project, site.origin());
            const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
                path: `/${project}/pricing`, position: { type: 'page' }, kind: 'feedback', authorName: 'Guest reviewer',
                text: `Feedback ${index + 1}: the plan cards are not aligned`, ...(index === 29 ? { screenshot } : {})
            } });
            expect(response.status(), await response.text()).toBe(201);
        }
        const reviewed = `${site.origin()}/${project}/pricing`;
        const open = async () => {
            await page.goto(`/app/review/${project}?url=${encodeURIComponent(reviewed)}`);
            await page.waitForURL(url => url.origin === site.origin());
        };
        const api = (path: string) => new RegExp(`/api/review/${project}${path}`);
        const inboxButton = () => page.getByRole('button', { name: /^Inbox(?:,|$)/ }).filter({ visible: true }).first();
        const sidebar = () => page.getByRole('complementary', { name: 'Comments' });

        await step('Toolbar starting', async () => {
            // The project (who the reviewer is, what they may do) is read before anything is drawn
            const gate = await hold(page, api('(\\?.*)?$'), route => route.request().method() === 'GET');
            await open();
            await gate.seen();
            await page.waitForTimeout(1_200);
            const recorded = await record({ id: 'toolbar-starting', title: 'Toolbar starting: the project is read first', route: reviewed,
                note: 'Nothing is drawn until the project answers (ProjectGate renders null): no pill, no pins.' });
            await gate.release();
            await expect(toolbar(page)).toBeVisible({ timeout: 15_000 });
            await page.waitForTimeout(800);
            recorded.loaded = await capture.shot(page, 'toolbar-starting--loaded');
        });

        await step('Inbox loading', async () => {
            const gate = await hold(page, api('/comments'), route => !/\/(screenshot|read|activity)/.test(route.request().url()));
            await open();
            await expect(toolbar(page)).toBeVisible({ timeout: 15_000 });
            await gate.seen();
            await page.waitForTimeout(600);
            await record({ id: 'toolbar-pill-comments-loading', title: 'Pill while the comments load', route: reviewed,
                note: 'The pill is usable; its counts arrive with the comments.' }, toolbar(page), 40);
            await inboxButton().click();
            await expect(sidebar()).toBeVisible();
            await expect(sidebar().locator('[data-uier-inbox-loading]')).toBeVisible();
            await page.waitForTimeout(500);
            const recorded = await record({ id: 'toolbar-inbox-loading', title: 'Inbox opening: comments loading', route: reviewed,
                note: 'Three card outlines where the cards go, the tabs without counts, and a visually hidden status, "Loading comments…".' });
            await gate.release();
            await expect(sidebar().getByRole('article').first()).toBeVisible({ timeout: 15_000 });
            await page.waitForTimeout(600);
            recorded.loaded = await capture.shot(page, 'toolbar-inbox-loading--loaded');
        });

        await step('Inbox next page', async () => {
            const gate = await hold(page, api('/comments'), route => /[?&]before=/.test(route.request().url()));
            const list = sidebar().locator('[data-uier-inbox-list]');
            await list.evaluate(element => {
                let scroller: HTMLElement | null = element as HTMLElement;
                while (scroller && scroller.scrollHeight <= scroller.clientHeight + 4) scroller = scroller.parentElement;
                scroller?.scrollTo(0, scroller.scrollHeight);
            });
            if (!await gate.seen(5_000)) { await gate.release(); throw new Error('No next page was requested'); }
            await page.waitForTimeout(400);
            await record({ id: 'toolbar-inbox-more', title: 'Inbox loading its next page', route: reviewed,
                note: 'One card outline under the last card, with the same visually hidden status.' });
            await gate.release();
        });

        await step('Screenshot thumbnail', async () => {
            const gate = await hold(page, /\/screenshot(\?|$)/);
            await open();
            await expect(toolbar(page)).toBeVisible({ timeout: 15_000 });
            await inboxButton().click();
            const placeholder = sidebar().locator('[data-image-placeholder]').first();
            await expect(placeholder).toBeVisible({ timeout: 15_000 });
            await placeholder.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await record({ id: 'toolbar-thread-screenshot', title: 'Thread: screenshot thumbnail loading', route: reviewed,
                note: 'A pulsing 96 x 64 box with the screenshot\'s ratio.' }, placeholder.locator('xpath=ancestor::article[1]'), 16);
            await gate.release();
        });

        await step('People to assign', async () => {
            const gate = await hold(page, api('/participants'));
            const card = sidebar().getByRole('article').first();
            await card.scrollIntoViewIfNeeded();
            await card.getByRole('button', { name: 'Thread options', exact: true }).first().click();
            await page.getByRole('button', { name: /Change assignee$/ }).filter({ visible: true }).first().click();
            await gate.seen();
            const people = sidebar().locator('[data-uier-people-loading]').first();
            await expect(people).toBeVisible();
            await expect(sidebar().getByRole('status').filter({ hasText: 'Loading people…' })).toHaveCount(1);
            await record({ id: 'toolbar-assign-people', title: 'Thread: people to assign loading', route: reviewed,
                note: 'Two outlines of a person\'s row between Unassign and Done, and a visually hidden status, "Loading people…".' }, people.locator('xpath=ancestor::article[1]'), 16);
            await gate.release();
        });

        await step('Accessibility check running', async () => {
            // The audit script (axe-core and the on-demand checks) is requested when a panel first needs it
            const gate = await hold(page, new RegExp(`/toolbar/${auditAsset}`));
            await open();
            await expect(toolbar(page)).toBeVisible({ timeout: 15_000 });
            await page.waitForTimeout(800);
            if (await pageChecksButton(page).count()) await openPageCheck(page, /^Accessibility/);
            else {
                await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
                await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^Accessibility/ }).click();
            }
            const panel = page.getByRole('complementary', { name: 'Accessibility' });
            await expect(panel).toBeVisible();
            await page.waitForTimeout(700);
            const recorded = await record({ id: 'toolbar-accessibility-checking', title: 'Accessibility panel: checking the page', route: reviewed,
                note: 'A spinner and "Checking this page…" while the audit script loads and runs.' });
            await gate.release();
            await expect(panel.getByRole('status').first()).toHaveText(/issues? found/, { timeout: 25_000 });
            await page.waitForTimeout(500);
            recorded.loaded = await capture.shot(page, 'toolbar-accessibility-checking--loaded');
        });

        for (const [id, name, label] of [['seo', /^SEO/, 'SEO'], ['security', /^Security and compliance/, 'Security and compliance']] as const) {
            await step(`${label} check running`, async () => {
                await open();
                await expect(toolbar(page)).toBeVisible({ timeout: 15_000 });
                // The panel's own requests to the site (robots.txt, the sitemap, linked pages, response headers) stay open
                const gate = await hold(page, new RegExp(`^${site.origin().replace(/[.]/g, '\\.')}/`), route => route.request().resourceType() !== 'document' || route.request().isNavigationRequest() === false);
                if (await pageChecksButton(page).count()) await openPageCheck(page, name);
                else {
                    await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
                    await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name }).click();
                }
                const panel = page.getByRole('complementary', { name: label });
                await expect(panel).toBeVisible();
                await page.waitForTimeout(1_500);
                const recorded = await record({ id: `toolbar-${id}-checking`, title: `${label} panel: checks running`, route: reviewed,
                    note: 'Sections that need a request show a 14 px spinner beside their title until it answers.' });
                for (const tab of id === 'seo' ? ['content', 'sharing', 'search'] : []) {
                    await showChecksTab(panel, tab);
                    await page.waitForTimeout(500);
                    await record({ id: `toolbar-seo-${tab}-checking`, title: `SEO panel, ${tab} tab: checks running`, route: reviewed });
                }
                await gate.release();
                await page.waitForTimeout(4_000);
                recorded.loaded = await capture.shot(page, `toolbar-${id}-checking--loaded`);
            });
        }
    } finally {
        capture.save();
        await site.close();
    }
});
