import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
    animationsFinished,
    commentBubble,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    selectText,
    selectionToolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Text comments, restoring pins and highlights, and the viewport saved with a comment

// In the FAQ, after the "uier app" link: not the paragraph's first text node
const faqQuestion = 'Can I use uier on my own website?';
const selectedText = 'add one script tag to your site';

type Box = { x: number; y: number; width: number; height: number };

/** Opens the FAQ answer that holds `selectedText` */
async function openFaqAnswer(page: Page) {
    await page.getByText(faqQuestion, { exact: true }).click();
    await expect(page.getByRole('main').getByText(selectedText, { exact: false })).toBeVisible();
}

/** Viewport box of `text` on the page */
async function textBox(page: Page, text: string): Promise<Box> {
    return await page.evaluate((text) => {
        const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const index = node.textContent?.indexOf(text) ?? -1;
            if (index >= 0) {
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + text.length);
                const { x, y, width, height } = range.getBoundingClientRect();
                return { x, y, width, height };
            }
        }
        throw new Error(`"${text}" is not on the page`);
    }, text);
}

/** The box around all the highlight tints of the page */
async function highlightBox(page: Page): Promise<Box | null> {
    const boxes = (await Promise.all((await page.locator('[data-uier-highlight]').all()).map(tint => tint.boundingBox())))
        .filter((box): box is Box => Boolean(box));
    if (!boxes.length) {
        return null;
    }
    const left = Math.min(...boxes.map(b => b.x));
    const top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.width));
    const bottom = Math.max(...boxes.map(b => b.y + b.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The tint covers the text (it is inset 4px from the line box at the top and bottom) */
async function expectHighlightOnText(page: Page, text: string) {
    await expect.poll(async () => {
        const [tint, words] = [await highlightBox(page), await textBox(page, text)];
        if (!tint) {
            return 'no highlight';
        }
        return Math.abs(tint.x - words.x) <= 1
            && Math.abs(tint.x + tint.width - (words.x + words.width)) <= 1
            && Math.abs(tint.y + tint.height / 2 - (words.y + words.height / 2)) <= 2
            ? 'on the text'
            : `off: ${JSON.stringify({ tint, words })}`;
    }).toBe('on the text');
}

type PinAnchor = { text: string } | { selector: string; xNormal: number; yNormal: number };

/**
 * The pin is centred 16px below and right of its anchor (CommentBubble.tsx), and kept 20px inside
 * the window horizontally: a text comment's last line, a point comment's point (a 1px box at
 * `xNormal`, `yNormal` of its element)
 */
async function expectPinAt(page: Page, pin: Locator, anchor: PinAnchor) {
    await expect.poll(async () => {
        const box = await pin.boundingBox();
        const expected = await page.evaluate((anchor) => {
            let rects: DOMRect[] = [];
            if ('text' in anchor) {
                const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node && !rects.length; node = walker.nextNode()) {
                    const index = node.textContent?.indexOf(anchor.text) ?? -1;
                    if (index >= 0) {
                        const range = document.createRange();
                        range.setStart(node, index);
                        range.setEnd(node, index + anchor.text.length);
                        rects = [...range.getClientRects()];
                    }
                }
            } else {
                const element = [...document.querySelector(anchor.selector)!.getClientRects()].at(-1)!;
                rects = [new DOMRect(element.left + element.width * anchor.xNormal, element.top + element.height * anchor.yNormal, 1, 1)];
            }
            const last = rects.reduce((lowest, rect) => rect.bottom >= lowest.bottom ? rect : lowest);
            const right = document.documentElement.clientWidth - 20;
            return { x: Math.min(Math.max(last.right + 16, 20), right), y: last.bottom + 16 };
        }, anchor);
        if (!box) {
            return 'no pin';
        }
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        return Math.abs(centre.x - expected.x) <= 2 && Math.abs(centre.y - expected.y) <= 2
            ? 'at its anchor'
            : `off: ${JSON.stringify({ centre, expected })}`;
    }).toBe('at its anchor');
}

/** Scrolls the page with the mouse wheel and waits until it moved and stopped (the wheel scrolls smoothly) */
async function scrollPage(page: Page, deltaY: number) {
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, deltaY);
    let previous = before;
    await expect.poll(async () => {
        const current = await page.evaluate(() => window.scrollY);
        const stopped = current > before && current === previous;
        previous = current;
        return stopped ? 'scrolled' : `scrollY ${current}, was ${before}`;
    }, { intervals: [100] }).toBe('scrolled');
}

/** A selector of the element in the form the toolbar stores (validation.ts): `tag:nth-of-type(n)` from `body` */
async function selectorOf(locator: Locator) {
    return await locator.evaluate((element) => {
        const parts: string[] = [];
        for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
            const sameTag = [...node.parentElement!.children].filter(sibling => sibling.tagName === node!.tagName);
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${sameTag.indexOf(node) + 1})`);
        }
        return parts.join('>');
    });
}

/** Creates a comment on `/` through the API from the page (visitor cookie and BotID headers) */
async function postComment(page: Page, body: Record<string, unknown>) {
    return await page.evaluate(async (body) => {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', ...body })
        });
        return { status: response.status, id: response.ok ? (await response.json() as { id: string }).id : undefined };
    }, body);
}

test('text comments: the selection toolbar, the saved anchor and its highlight', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    await openFaqAnswer(page);

    // Selecting text shows the selection toolbar with Add comment
    await selectText(page, selectedText);
    await expect(selectionToolbar(page)).toBeVisible();
    await selectionToolbar(page).getByRole('button', { name: 'Add comment' }).click();
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();
    await expect(openThread(page).locator('blockquote')).toHaveText(selectedText);
    await composer.fill('Which parts, exactly?');
    await composer.press('Enter');

    // The thread of the selection opens
    const thread = openThread(page);
    await expect(commentBubble(page, 1)).toBeVisible();
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeFocused();
    await expect(thread.getByText('Which parts, exactly?')).toBeVisible();
    await expect(thread.locator('blockquote')).toHaveText(selectedText);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    // Saved with its text anchor: the offset counts all of the paragraph's text
    const [saved] = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as { id: string; position: Record<string, unknown> }[]);
    const paragraphText = await page.getByRole('main').getByText(selectedText, { exact: false }).textContent();
    expect(saved?.position).toMatchObject({
        type: 'text',
        text: selectedText,
        startType: 'text',
        startOffset: paragraphText!.indexOf(selectedText),
        endOffset: paragraphText!.indexOf(selectedText) + selectedText.length
    });
    await expectHighlightOnText(page, selectedText);

    // And a point comment on the question above the text, 3/4 across and 1/4 down
    const point = { type: 'point', selector: await selectorOf(page.getByText(faqQuestion, { exact: true })), xNormal: 0.75, yNormal: 0.25 };
    const pointComment = await postComment(page, { position: point, text: 'Is it one tag for every page?' });
    expect(pointComment.status).toBe(201);
    const textPin = page.locator(`[data-uier-comment="${saved!.id}"]`);
    const pointPin = page.locator(`[data-uier-comment="${pointComment.id}"]`);

    // Restored after a reload (once the answer is open again), after scrolling and resizing: the
    // tint stays on the text, the pins next to their text and element
    const expectAnchored = async () => {
        await expectHighlightOnText(page, selectedText);
        await expectPinAt(page, textPin, { text: selectedText });
        await expectPinAt(page, pointPin, point);
    };
    await page.reload();
    await expect(page.locator('[data-uier-highlight]')).toHaveCount(0);
    await openFaqAnswer(page);
    await expectAnchored();
    await expect(textPin).toBeInViewport();
    await expect(pointPin).toBeInViewport();
    // Waits for the smooth scroll to end: a resize during it would leave the text out of the window
    await scrollPage(page, 120);
    await expectAnchored();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width - 80, height: viewport.height - 60 });
    await expectAnchored();

    // Clicking the highlighted text opens the thread (the first tint: the text may wrap on narrow screens)
    const firstTint = page.locator('[data-uier-highlight]').first();
    await expect(firstTint).toBeInViewport();
    const tint = await firstTint.boundingBox();
    await page.mouse.click(tint!.x + tint!.width / 2, tint!.y + tint!.height / 2);
    await expect(thread.getByText('Which parts, exactly?')).toBeVisible();
    await expect(thread.locator('blockquote')).toHaveText(selectedText);
    await animationsFinished(thread);
    await expectNoAxeViolations(page);

    await context.close();
});

test('text that moved is found again; text that is gone keeps a fallback pin', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    // The hero's description paragraph (selectors in the toolbar's form, see validation.ts)
    const paragraph = 'main>section>div>p';
    const anchor = { type: 'text', startSelector: paragraph, startType: 'text', endSelector: paragraph, endType: 'text' };

    // Offsets that no longer match (the page changed): the text is found in the paragraph
    expect((await postComment(page, {
        position: { ...anchor, text: 'leaving comments directly', startOffset: 0, endOffset: 5 },
        text: 'Moved words'
    })).status).toBe(201);
    // Text that is not on the page anymore
    expect((await postComment(page, {
        position: { ...anchor, text: 'A sentence that was edited away', startOffset: 0, endOffset: 31 },
        quotedText: 'A sentence that was edited away',
        text: 'Gone words'
    })).status).toBe(201);
    await page.reload();

    await expectHighlightOnText(page, 'leaving comments directly');
    await expect(page.locator('[data-uier-highlight]')).not.toHaveCount(0);

    const fallbackPin = page.getByRole('button', { name: 'Comment, 1 message. The commented text is no longer on the page', exact: true });
    await expect(fallbackPin).toBeVisible();
    // At the paragraph the text was in
    // On touch, the 32 px mark has a larger hit area. Compare the visible mark with its anchor.
    const pin = await fallbackPin.locator('svg').boundingBox();
    // The element the toolbar resolves the selector to
    const box = await page.evaluate((selector) => {
        const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { x, y, width, height };
    }, paragraph);
    expect(pin!.x).toBeGreaterThanOrEqual(box!.x);
    expect(pin!.y).toBeGreaterThanOrEqual(box!.y);
    expect(pin!.y).toBeLessThan(box!.y + box!.height);

    await fallbackPin.click();
    const thread = openThread(page);
    await expect(thread.getByText('The commented text is no longer on the page.')).toBeVisible();
    await expect(thread.locator('blockquote')).toHaveText('A sentence that was edited away');
    await expect(thread.getByText('Gone words')).toBeVisible();

    await context.close();
});

test('every comment keeps the viewport it was left from', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    /** Leaves a comment with the keyboard; returns the viewport it was left from */
    const comment = async (text: string) => {
        await page.getByRole('main').getByRole('link', { name: 'How it works' }).focus();
        await page.getByRole('button', { name: 'Add comment' }).focus();
        await page.keyboard.press('Enter');
        const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill(text);
        const viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight] as [number, number]);
        await composer.press('Enter');
        await expect(openThread(page).getByRole('textbox', { name: 'Reply' })).toBeFocused();
        await expect(openThread(page).getByText(text)).toBeVisible();
        await expect(openThread(page).getByText(`${viewport[0]}×${viewport[1]}`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(openThread(page)).toBeHidden();
        return viewport;
    };

    const first = await comment('Left at the first size');
    // Smaller than a tablet: a mobile size
    await page.setViewportSize({ width: 700, height: 600 });
    const second = await comment('Left after a resize');
    expect(second).toEqual([700, 600]);

    // Fetched again, each comment has the viewport from when it was posted
    const saved = await page.evaluate(async () => (await (await fetch('/api/comments?path=/')).json() as { thread: { items: { text: string }[] }; device: unknown }[])
        .map(c => [c.thread.items[0]?.text, c.device]));
    expect(saved).toEqual(expect.arrayContaining([
        ['Left at the first size', expect.objectContaining({ windowSize: first })],
        ['Left after a resize', { size: 'mobile', windowSize: [700, 600] }]
    ]));

    // And shows it after a reload, at any window size
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.reload();
    await page.getByRole('button', { name: 'Inbox, 2 comments' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByText(`${first[0]}×${first[1]}`)).toBeVisible();
    await expect(sidebar.getByText('Mobile · 700×600')).toBeVisible();

    await context.close();
});
