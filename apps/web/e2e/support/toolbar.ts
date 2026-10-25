import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';

// The toolbar renders into an open shadow root (#uier-toolbar); Playwright locators pierce it.

export const toolbar = (page: Page) => page.getByRole('group', { name: 'uier feedback toolbar' });
export const showcaseHint = (page: Page) => page.getByRole('region', { name: 'Try uier on this page' });
export const commentBubbles = (page: Page) => page.getByRole('button', { name: /^Comment, \d+ messages?$/ });
export const commentBubble = (page: Page, messages: number) =>
    page.getByRole('button', { name: `Comment, ${messages} ${messages === 1 ? 'message' : 'messages'}`, exact: true });
/** Waits for the element's animations (a popover fading in) to finish, e.g. before an axe check */
export async function animationsFinished(locator: Locator) {
    await locator.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true })
            .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
            .map(animation => animation.finished));
    });
}

/** The toolbar shown for selected page text */
export const selectionToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected text' });
/** Comment thread popover (only one is open at a time) */
export const openThread = (page: Page) => page.getByRole('dialog');

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

/** Opens the landing page and waits for the showcase toolbar */
export async function openLanding(page: Page, origin: string, { dismissHint = false } = {}) {
    await page.goto(`${origin}/`);
    await expect(toolbar(page)).toBeVisible();
    if (dismissHint) {
        await showcaseHint(page).getByRole('button', { name: 'Got it' }).click();
        await expect(showcaseHint(page)).toBeHidden();
    }
}

/**
 * Adds the toolbar script like a site would (review mode: no `data-uier-mode`). Not
 * `page.addScriptTag`: it fails on the CSP report for the Google Fonts stylesheet the toolbar
 * adds (blocked here, the toolbar then uses system-ui).
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
        const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
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
