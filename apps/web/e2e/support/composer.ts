import type { Locator } from '@playwright/test';

/**
 * Message composers are the rich editor (`@uier/toolbar/editor`, a `contenteditable` with `role="textbox"`), not a
 * textarea: read their text with `toHaveText(text, { useInnerText: true })` (line breaks as spaces), and select in
 * them with these.
 */

/** Selects the characters from `start` to `end` of the composer's text, as a person dragging over them would */
export async function selectText(composer: Locator, start: number, end: number) {
    await composer.evaluate((element, [from, to]) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let anchor: [Node, number] | undefined;
        let focus: [Node, number] | undefined;
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const length = node.textContent?.length ?? 0;
            if (!anchor && from! <= seen + length) anchor = [node, from! - seen];
            if (!focus && to! <= seen + length) focus = [node, to! - seen];
            seen += length;
        }
        if (!anchor || !focus) throw new Error('The composer has no such text');
        (element as HTMLElement).focus();
        element.ownerDocument.getSelection()!.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
    }, [start, end]);
}

/** The text selected in the composer (its shadow root's selection, in the toolbar) */
export function selectedText(composer: Locator) {
    return composer.evaluate(element => {
        const root = element.getRootNode() as Document & { getSelection?: () => Selection | null };
        return (root.getSelection?.() ?? element.ownerDocument.getSelection())?.toString() ?? '';
    });
}
