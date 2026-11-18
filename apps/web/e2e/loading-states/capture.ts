import { instant } from '@next/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Shared by the loading-state captures: where screenshots go, what is recorded about each, and the two ways a route
// is held in its loading state (a full load and a client navigation, both under Next's instant-navigation lock).

// Kept between runs and ignored by git; `gallery.mjs` builds its pages in the same folder
export const captureRoot = process.env.CAPTURE_DIR ?? 'playwright-report/loading-states';

export type Entry = {
    id: string;
    surface: 'app' | 'toolbar' | 'extension' | 'public';
    group: string;
    title: string;
    /** `hard`: a full page load; `soft`: a client navigation; `in-page`: a state inside a loaded page */
    trigger: 'hard' | 'soft' | 'in-page';
    route?: string;
    from?: string;
    note?: string;
    viewport: string;
    file: string;
    /** The same view once loaded, for comparison */
    loaded?: string;
    /** `role="status"` labels visible in the capture */
    statuses?: string[];
    /** Skeleton blocks in the capture, and how many of them pulse */
    skeletons?: { total: number; animated: number };
    http?: number;
    /** Where a navigation ended up while locked, when not on `route` */
    landed?: string;
};

export class Capture {
    readonly entries: Entry[] = [];
    readonly dir: string;
    readonly viewport: string;

    constructor(readonly info: TestInfo, readonly name: string) {
        this.viewport = info.project.name;
        this.dir = join(captureRoot, this.viewport);
        mkdirSync(this.dir, { recursive: true });
    }

    async shot(page: Page, id: string) {
        const file = `${id}.png`;
        // Infinite animations (the skeletons' pulse) are reset, so two runs give the same picture
        await page.screenshot({ path: join(this.dir, file), animations: 'disabled', caret: 'hide' });
        return `${this.viewport}/${file}`;
    }

    /** What the page says about its loading state: status labels and skeleton blocks, light DOM and open shadow roots */
    async describe(page: Page) {
        return page.evaluate(() => {
            const roots: (Document | ShadowRoot)[] = [document];
            for (const element of document.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
            const visible = (element: Element) => (element as HTMLElement).checkVisibility?.({ checkOpacity: false, checkVisibilityCSS: true }) ?? true;
            const statuses: string[] = [];
            let total = 0, animated = 0;
            for (const root of roots) {
                for (const status of root.querySelectorAll('[role="status"]')) {
                    if (!visible(status)) continue;
                    const label = status.getAttribute('aria-label') ?? status.textContent?.trim().slice(0, 80) ?? '';
                    if (label) statuses.push(label);
                }
                for (const skeleton of root.querySelectorAll('[data-slot="skeleton"], .animate-pulse')) {
                    if (!visible(skeleton)) continue;
                    total++;
                    if (getComputedStyle(skeleton).animationName !== 'none') animated++;
                }
            }
            return { statuses, skeletons: { total, animated } };
        });
    }

    async record(page: Page, entry: Omit<Entry, 'viewport' | 'file' | 'statuses' | 'skeletons'>) {
        const described = await this.describe(page);
        const file = await this.shot(page, entry.id);
        const full: Entry = { ...entry, viewport: this.viewport, file, ...described };
        this.entries.push(full);
        return full;
    }

    save() {
        writeFileSync(join(captureRoot, `manifest-${this.name}-${this.viewport}.json`), JSON.stringify(this.entries, null, 2));
    }
}

type Router = { push(href: string): void; prefetch(href: string, options?: { kind: string }): void };
/** Next's app router, as Links use it (`window.next.router`): the App Shell a Link in view would have prefetched */
export const prefetch = (page: Page, href: string) => page.evaluate(to => {
    (window as unknown as { next: { router: Router } }).next.router.prefetch(to, { kind: 'auto' });
}, href);
export const push = (page: Page, href: string) => page.evaluate(to => {
    (window as unknown as { next: { router: Router } }).next.router.push(to);
}, href);

/** Waits until nothing on the page says it is loading, then for the fonts and a frame */
export async function settled(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => {
        // Statuses, the comments' and a thread's skeletons, and the frames a group draws before the request is read
        const loading = [...document.querySelectorAll('[role="status"][aria-label^="Loading"], [data-comments-loading], [data-thread-shell="loading"], [data-shell-frame], [data-auth-frame], [data-status-outline]')];
        return loading.every(element => !(element as HTMLElement).checkVisibility());
    }, undefined, { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
}

/**
 * A full page load held at its static shell: what the first bytes of the document show before any request data. The
 * lock is released afterwards and the loaded page is captured when `loaded` is set.
 */
export async function hardLoad(capture: Capture, page: Page, baseURL: string, entry: Omit<Entry, 'viewport' | 'file' | 'trigger' | 'statuses' | 'skeletons'> & { route: string }, { loaded = false }: { loaded?: boolean } = {}) {
    let recorded!: Entry;
    await instant(page, async () => {
        const response = await page.goto(entry.route, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        recorded = await capture.record(page, { ...entry, trigger: 'hard', http: response?.status() });
    }, { baseURL });
    if (loaded) {
        // A document that was served locked stays at its shell: load it again as a browser would
        await page.goto(entry.route);
        await settled(page);
        recorded.loaded = await capture.shot(page, `${entry.id}--loaded`);
    }
    return recorded;
}

/**
 * A document's first paint where the lock cannot hold it: a denied address answers 404 with no prerendered shell, so
 * under the lock it is an empty page, which no browser shows. This serves the document's own HTML cut off before its
 * first streamed boundary, with its scripts held back, so the page stays as its first bytes drew it.
 */
export async function firstPaint(capture: Capture, page: Page, entry: Omit<Entry, 'viewport' | 'file' | 'trigger' | 'statuses' | 'skeletons'> & { route: string }) {
    const response = await page.request.get(entry.route);
    const html = await response.text();
    // React streams a boundary's content as a hidden element (`S:<n>`) with a script that swaps it in
    const cut = html.search(/<div hidden="?"? id="S:/);
    const shell = cut > 0 ? html.slice(0, cut) : html;
    const pattern = (url: URL) => url.pathname === entry.route;
    await page.route(pattern, route => route.fulfill({ status: response.status(), contentType: 'text/html; charset=utf-8', body: shell }));
    await page.route('**/_next/static/**/*.js', route => route.abort());
    await page.goto(entry.route, { waitUntil: 'commit' }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    await page.waitForTimeout(700);
    const recorded = await capture.record(page, { ...entry, trigger: 'hard', http: response.status() });
    await page.unroute(pattern);
    await page.unroute('**/_next/static/**/*.js');
    await page.goto(entry.route);
    await settled(page);
    recorded.loaded = await capture.shot(page, `${entry.id}--loaded`);
    return recorded;
}

/**
 * A client navigation held at the destination's prefetched shell: from `from` (a fresh document, so the destination
 * was never shown and kept) to `route`, as a Link does it. The loaded page is captured after the lock is released.
 */
export async function softNav(capture: Capture, page: Page, entry: Omit<Entry, 'viewport' | 'file' | 'trigger' | 'statuses' | 'skeletons'> & { route: string; from: string }, { loaded = true, prepare }: { loaded?: boolean; prepare?: () => Promise<void> } = {}) {
    await page.goto(entry.from);
    await settled(page);
    await prepare?.();
    // The App Shell a Link in view would have prefetched
    await prefetch(page, entry.route);
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(200);
    let recorded: Entry | undefined;
    const start = await page.evaluate(() => location.pathname + location.search);
    await instant(page, async () => {
        await push(page, entry.route);
        // The address the router commits: the route, or where its prefetched shell redirects
        const moved = await page.waitForFunction(from => location.pathname + location.search !== from, start, { timeout: 8_000 }).then(() => true, () => false);
        if (!moved) return console.warn(`[capture] ${entry.id}: the navigation to ${entry.route} did not commit while locked`);
        await page.waitForTimeout(450);
        const landed = await page.evaluate(() => location.pathname + location.search);
        recorded = await capture.record(page, { ...entry, trigger: 'soft', ...(landed === entry.route ? {} : { landed }) });
    });
    if (!recorded) return undefined;
    if (loaded) {
        await settled(page);
        recorded.loaded = await capture.shot(page, `${entry.id}--loaded`);
    }
    return recorded;
}
