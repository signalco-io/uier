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

test('point mode outlines and anchors what is under a stretched link', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    // A list row as admin UIs build it: the title link's `::after` covers the row, so all of it opens the record
    await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('[data-stretched-row] a::after { content: ""; position: absolute; inset: 0 }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        const row = document.createElement('article');
        row.dataset.stretchedRow = '';
        row.style.cssText = 'position: fixed; z-index: 40; top: 120px; left: 24px; display: flex; gap: 12px; padding: 12px; width: 300px; background: white';
        row.innerHTML = `<img alt="Asparagus soup" width="80" height="60" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="gray"/></svg>')}">`
            + '<div><a href="#record">Asparagus soup</a><p style="margin: 4px 0 0">Tastes like spring</p></div>';
        document.body.append(row);
    });
    const row = page.locator('[data-stretched-row]');
    const picture = row.getByRole('img', { name: 'Asparagus soup' });
    const summary = row.getByText('Tastes like spring');
    const title = row.getByRole('link', { name: 'Asparagus soup' });

    await page.getByRole('button', { name: 'Add comment' }).click();
    const outline = page.locator('[data-uier-outline]');
    for (const target of [picture, summary, title]) {
        const box = (await target.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(async () => {
            const outlined = await outline.boundingBox();
            return outlined && Math.abs(outlined.x - box.x) <= 1 && Math.abs(outlined.y - box.y) <= 1
                && Math.abs(outlined.width - box.width) <= 1 && Math.abs(outlined.height - box.height) <= 1
                ? 'outlined'
                : `off: ${JSON.stringify({ outlined, box })}`;
        }).toBe('outlined');
    }

    // The comment is saved on the picture, not on the link above it
    const box = (await picture.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('A brighter picture, please.');
    await composer.press('Enter');
    await expect(commentBubble(page, 1)).toBeVisible();
    const [saved] = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as { id: string; position: { selector: string; xNormal: number; yNormal: number } }[]);
    expect(await picture.evaluate((element, selector) => document.querySelector(selector) === element, saved!.position.selector)).toBe(true);
    await expectPinAt(page, page.locator(`[data-uier-comment="${saved!.id}"]`), saved!.position);

    await context.close();
});

test('text that moved is found again; text that is gone stays reachable in the inbox', async ({ browser }, testInfo) => {
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

    await expect(page.getByRole('button', { name: 'Comment, 1 message', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    const gone = sidebar.getByRole('article').filter({ hasText: 'Gone words' });
    await expect(gone.getByText('Target is missing from this page.')).toBeVisible();
    await expect(gone.locator('blockquote')).toHaveText('A sentence that was edited away');
    await expect(gone.getByRole('button', { name: 'Show on page' })).toHaveCount(0);

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
        // The device icon next to the time names the viewport
        await expect(openThread(page).getByRole('button', { name: new RegExp(`^Device: .*${viewport[0]}×${viewport[1]}`) })).toBeVisible();
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
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('button', { name: new RegExp(`^Device: .*${first[0]}×${first[1]}`) })).toBeVisible();
    const mobile = sidebar.getByRole('button', { name: 'Device: Mobile · 700×600 px' });
    await mobile.click();
    const details = page.getByRole('dialog', { name: 'Device', exact: true });
    await expect(details).toContainText('Mobile');
    await expect(details).toContainText('700×600 CSS px');

    await context.close();
});
