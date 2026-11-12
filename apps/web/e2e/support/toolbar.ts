import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';

// The toolbar renders into an open shadow root (#uier-toolbar); Playwright locators pierce it.

export const toolbar = (page: Page) => page.getByRole('group', { name: 'uier feedback toolbar' });
export const showcaseHint = (page: Page) => page.getByRole('region', { name: 'Try uier on this page' });
/** Saved comments' pins: "Comment #6, 3 messages" (no number on old comments; the status but Open after it, ", In progress") */
export const commentBubbles = (page: Page) => page.getByRole('button', { name: /^Comment(?: #\d+)?, \d+ messages?(?:, [^,]+)?$/ });
/** An open comment's pin by its message count, and its number when given */
export const commentBubble = (page: Page, messages: number, number?: number) =>
    page.getByRole('button', { name: new RegExp(`^Comment${number === undefined ? '(?: #\\d+)?' : ` #${number}`}, ${messages} ${messages === 1 ? 'message' : 'messages'}$`) });
/** Waits for the element's animations (a popover fading in) to finish, e.g. before an axe check */
export async function animationsFinished(locator: Locator) {
    await locator.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true })
            .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
            .map(animation => animation.finished));
    });
}

/**
 * Shows a tab of a checks panel (Accessibility: issues, keyboard, screenReader, visual; SEO: page,
 * content, sharing, search), whose sections are hidden while another tab is shown
 */
export async function showChecksTab(panel: Locator, tab: string) {
    const button = panel.locator(`[role="tab"][data-uier-tab="${tab}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-selected', 'true');
}

/** The toolbar shown for selected page text */
export const selectionToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected text' });
/** Comment thread popover (only one is open at a time); not the Copy and Thread options menus in its header */
export const openThread = (page: Page) => page.getByRole('dialog', { name: /^(?!Copy$|Thread options$)/ });

/** The open inbox's location picker: the environment (in a project with several), then this page, all pages, sections and the other pages */
export const inboxPages = (page: Page) => page.getByRole('complementary', { name: 'Comments' }).getByRole('button', { name: /^(Pages|Environment and page):/ });

/** The open location picker: this page, all pages and the sections on the left, the other pages on the right (each named with its count: "/about, 3 comments") */
export const inboxPageOptions = (page: Page) => page.getByRole('dialog', { name: /^(Pages|Environment and page)$/ });

/**
 * How many threads the open inbox lists: it renders only the cards near its view (virtualized), and each card says
 * where it is in the list (`aria-posinset`, `aria-setsize`)
 */
export async function expectInboxListed(inbox: Locator, count: number) {
    await expect(inbox.getByRole('article').first()).toHaveAttribute('aria-setsize', String(count));
}

/** The pill's Page checks button: Accessibility, SEO and Security and compliance behind one menu (uier #353) */
export const pageChecksButton = (page: Page) => toolbar(page).getByRole('button', { name: /^Page checks/ });

/** A page tool in the open Page checks menu, named with what its check found ("SEO, 2 to look at") */
export const pageCheckItem = (page: Page, name: RegExp | string) => page.getByRole('dialog', { name: 'Page checks' }).getByRole('button', { name });

/**
 * Opens (or closes) a page tool's panel from the pill: through the Page checks menu, or the tool's own button when the
 * review shows only one tool
 */
export async function openPageCheck(page: Page, name: RegExp) {
    const group = pageChecksButton(page);
    const own = toolbar(page).getByRole('button', { name });
    // The pill's tools show once the toolbar has loaded: wait for either
    await expect(group.or(own).first()).toBeVisible({ timeout: 15_000 });
    if (await group.count()) {
        await group.click();
        await pageCheckItem(page, name).click();
    } else await own.click();
}

/** A page tool's name in the Page checks menu ("Accessibility, 3 issues found"): the menu opens for it and closes again */
export async function pageCheckName(page: Page, name: RegExp) {
    await pageChecksButton(page).click();
    const label = await pageCheckItem(page, name).getAttribute('aria-label');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Page checks' })).toBeHidden();
    // Off the button, so its hover does not count as its highlight
    await page.mouse.move(0, 0);
    return label;
}

/** Whether a page tool's panel is open, as its item in the Page checks menu says (`aria-expanded`): the menu opens for it and closes again */
export async function expectPageCheckExpanded(page: Page, name: RegExp, expanded: boolean) {
    await pageChecksButton(page).click();
    await expect(pageCheckItem(page, name)).toHaveAttribute('aria-expanded', String(expanded));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Page checks' })).toBeHidden();
    // Off the button, so its hover does not count as its highlight
    await page.mouse.move(0, 0);
}

/** The open inbox's search field: its search button in the title row opens it first when it is closed */
export async function inboxSearch(inbox: Locator) {
    const field = inbox.getByRole('searchbox', { name: 'Search comments' });
    if (!await field.isVisible()) await inbox.locator('[data-uier-inbox-search]').click();
    await expect(field).toBeFocused();
    return field;
}

/**
 * Chooses which pages the open inbox lists: `/^This page/`, `/^All pages/` or another page's path
 * (the options' names end with their count)
 */
export async function chooseInboxPages(page: Page, name: RegExp) {
    await inboxPages(page).click();
    await inboxPageOptions(page).getByRole('button', { name }).click();
    await expect(inboxPageOptions(page)).toBeHidden();
}

/**
 * A fresh origin for one test: `<label>.localhost` resolves to the loopback address in Chromium
 * (no DNS needed), and the comments API partitions comments by host, so tests running in
 * parallel (and both device projects) never see each other's comments on `/`.
 */
export function isolatedOrigin(testInfo: TestInfo) {
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) {
        throw new Error('baseURL is not configured');
    }

    const url = new URL(baseURL);
    const label = [
        testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        `w${testInfo.workerIndex}`,
        `r${testInfo.retry}`,
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 8)
    ].join('-');
    return `${url.protocol}//${label}.localhost${url.port ? `:${url.port}` : ''}`;
}

/** A new anonymous visitor: own browser context (own `uier_visitor` cookie and localStorage), same device as the project */
export async function newVisitor(browser: Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page }> {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, colorScheme, reducedMotion } = testInfo.project.use;
    const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, colorScheme, reducedMotion });
    const page = await context.newPage();
    return { context, page };
}

/** Close a fresh guide before exercising other review controls. */
export async function dismissFirstRunHint(page: Page) {
    const hint = showcaseHint(page);
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toBeHidden();
}

/** Opens the landing page and waits for the showcase toolbar */
export async function openLanding(page: Page, origin: string, { dismissHint = false } = {}) {
    await page.goto(`${origin}/`);
    await expect(toolbar(page)).toBeVisible();
    if (dismissHint) {
        await dismissFirstRunHint(page);
    }
}

/**
 * Adds the toolbar script like a site would (review mode: no `data-uier-mode`, no first-run
 * hint). Not `page.addScriptTag`: it fails on the CSP report for the Google Fonts stylesheet the
 * toolbar adds (blocked here, the toolbar then uses system-ui).
 */
export async function addToolbarScript(page: Page) {
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/toolbar.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('The toolbar script did not load'));
        document.head.appendChild(script);
    }));
}

/** Selects `text` in the page (inside one text node) like a reviewer would */
export async function selectText(page: Page, text: string) {
    await page.evaluate((text) => {
        // Visible text only: a structured-data `<script>` in `<main>` can repeat the same words
        const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.parentElement?.closest('script,style,template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const index = node.textContent?.indexOf(text) ?? -1;
            if (index >= 0) {
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + text.length);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
                return;
            }
        }
        throw new Error(`"${text}" is not on the page`);
    }, text);
}

/** Opens a thread's Thread options (its triage and email controls: assign, priority, Request verification, follow, mute, Mark as unread) */
export async function threadOptions(page: Page, thread: Locator) {
    await thread.getByRole('button', { name: 'Thread options', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Thread options', exact: true });
    await expect(menu).toBeVisible();
    return menu;
}

/** Opens a thread's status menu (its badge: "Status: Open. Change status") and chooses `status` ("Done", "In progress", "Done without verification" ...) */
export async function setThreadStatus(page: Page, thread: Locator, status: string) {
    await thread.getByRole('button', { name: /^Status: .+\. Change status$/ }).click();
    const menu = page.getByRole('dialog', { name: 'Status', exact: true });
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: status, exact: true }).click();
    await expect(menu).toBeHidden();
}

/** Copy, in a thread's header: the issue (Markdown) or the link (opens the page at the thread) */
export async function copyFromThread(page: Page, thread: Locator, what: 'Copy issue' | 'Copy link') {
    await thread.getByRole('button', { name: 'Copy', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Copy', exact: true });
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: new RegExp(`^${what}`) }).click();
    await expect(menu).toHaveCount(0);
}
