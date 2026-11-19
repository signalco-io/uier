import { expect, test } from '@playwright/test';
import { hasTextChanges, rewriteOriginalText, textChangeSummary, textChanges } from '@uier/toolbar/change-proposal';
import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import { rewriteWithoutProposal } from '../../../packages/toolbar/src/rewriteProposal';

// The word diff a saved suggestion shows against its original text (`@uier/toolbar/change-proposal`), in the app's
// thread and the toolbar's, and the original a rewrite without a proposal compares with. The browser side is
// `rewrite-diff.spec.ts` and `rewrite.spec.ts`.

/** The diff as `-removed`, `+added` and kept text */
const diff = (original: string, proposed: string) => textChanges(original, proposed)
    .map(change => change.type === 'same' ? change.text : `${change.type === 'removed' ? '-' : '+'}[${change.text}]`).join('');

test('changed words show as one removal and one addition, kept words as they are', () => {
    expect(diff('the quick brown fox', 'a slow brown fox')).toBe('-[the quick]+[a slow] brown fox');
    expect(diff('Hello big world', 'Hello world')).toBe('Hello-[ big] world');
    expect(diff('Hello world', 'Hello big world')).toBe('Hello+[ big] world');
    expect(diff("don't stop", 'do not stop')).toBe("-[don't]+[do not] stop");
    expect(diff('Review any live website by leaving comments directly on it.', 'Comment on any live website, right on the page.'))
        .toBe('-[Review]+[Comment on] any live website-[ by leaving comments directly]+[, right] on -[it]+[the page].');
    expect(diff('Case', 'case')).toBe('-[Case]+[case]');
    // An addition or removal alone keeps its space, so each side reads as written
    expect(diff('Pins are in the toolbar.', 'Pins are in the toolbar at the bottom.')).toBe('Pins are in the toolbar+[ at the bottom].');
});

test('a joined emoji or a skin tone is one character: changed whole, never split between runs', () => {
    expect(diff('Ship it 👩‍💻', 'Ship it 👨‍💻')).toBe('Ship it -[👩‍💻]+[👨‍💻]');
    expect(diff('Thanks 👍🏽', 'Thanks 👍🏿')).toBe('Thanks -[👍🏽]+[👍🏿]');
    expect(diff('👩‍💻 rocks', '👩‍💻 rules')).toBe('👩‍💻 -[rocks]+[rules]');
    expect(diff('Made in 🇭🇷', 'Made in 🇩🇪')).toBe('Made in -[🇭🇷]+[🇩🇪]');
    expect(diff('Caf\u00e9', 'Cafe\u0301')).toBe('-[Caf\u00e9]+[Cafe\u0301]');
});

test('only spacing or line breaks changing is its own state, apart from no change at all', () => {
    // A page that keeps line breaks shows the newline turning into a space; a nonbreaking space keeps words together
    expect(textChangeSummary('Line one\nLine two', 'Line one Line two')).toBe('spacing');
    expect(textChangeSummary('Ten\u00a0km', 'Ten km')).toBe('spacing');
    expect(textChangeSummary('Same words', 'Same words')).toBe('none');
    // The selection's own leading and trailing space is never part of the suggestion
    expect(textChangeSummary('  Same words\n', 'Same words')).toBe('none');
    expect(textChangeSummary('Same words', 'Same word')).toBe('words');
});

test('a suggestion that only changes spacing or line breaks changes no words', () => {
    for (const [original, proposed] of [['Same words', 'Same words'], ['Same  words\n', 'Same words'], ['Line\nbreak', 'Line break'], ['', '']]) {
        const changes = textChanges(original!, proposed!);
        expect(hasTextChanges(changes)).toBe(false);
        // What shows is the suggestion, with its own spacing
        expect(changes.map(change => change.text).join('')).toBe(proposed);
    }
    expect(hasTextChanges(textChanges('', 'New'))).toBe(true);
    expect(hasTextChanges(textChanges('Old', ''))).toBe(true);
});

test('reading the kept and removed text gives the original, the kept and added text the suggestion', () => {
    const pairs = [
        ['Pins, threads, screenshots and the inbox are in the toolbar.', 'Pins, threads and screenshots are in the toolbar at the bottom.'],
        ['One. Two. Three.', 'Three. Two. One.'],
        ['Ünïcödé wörds stay whole', 'Ünïcödé words stay whole'],
        ['a b c d e f', 'f e d c b a']
    ] as const;
    for (const [original, proposed] of pairs) {
        const changes = textChanges(original, proposed);
        const side = (skip: string) => changes.filter(change => change.type !== skip).map(change => change.text).join('');
        expect(side('added')).toBe(original);
        expect(side('removed')).toBe(proposed);
    }
});

test('long texts stay fast: past the comparison budget the changed middle is replaced as a whole', () => {
    const original = Array.from({ length: 2000 }, (_, index) => `word${index}`).join(' ');
    const proposed = Array.from({ length: 2000 }, (_, index) => `term${index}`).join(' ');
    const started = performance.now();
    const changes = textChanges(`Start ${original} end`, `Start ${proposed} end`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(changes.map(change => change.type)).toEqual(['same', 'removed', 'added', 'same']);
});

test('a rewrite without a proposal compares with its quote, or its full selection when the quote is missing or cut', () => {
    const long = Array.from({ length: 150 }, (_, index) => `Sentence ${index}.`).join(' ');
    expect(long.length).toBeGreaterThan(1000);
    const cut = long.slice(0, 1000);
    expect(rewriteOriginalText(long, cut)).toBe(long);
    // The API trims the cut quote, so it can be shorter than the limit
    expect(rewriteOriginalText(long, cut.trimEnd())).toBe(long);
    expect(rewriteOriginalText(' Selected text\n', undefined)).toBe(' Selected text\n');
    expect(rewriteOriginalText(' Selected text\n', 'Selected text')).toBe(' Selected text\n');
    // A quote of its own (an older client's) is what the author saw
    expect(rewriteOriginalText('Selected text', 'Other text')).toBe('Other text');
    expect(rewriteOriginalText('Selected text', 'Selected')).toBe('Selected');
    expect(rewriteOriginalText(undefined, undefined)).toBeUndefined();

    // The toolbar's thread: keeping the first 1000 characters of a longer selection removes its tail
    const comment = (selection: string, quotedText: string | undefined, text: string) => ({
        id: 'comment', path: '/', kind: 'rewrite',
        position: { type: 'text', text: selection, startSelector: 'p', startOffset: 0, startType: 'text', endSelector: 'p', endOffset: selection.length, endType: 'text' },
        thread: { items: [{ id: 'item', text, ...(quotedText ? { quotedText } : {}), author: { name: 'Reviewer', isMe: false } }] }
    }) as unknown as CommentItem;
    const truncated = rewriteWithoutProposal(comment(long, cut, cut.trimEnd()));
    expect(truncated).toEqual({ original: long, proposed: cut.trimEnd() });
    expect(textChangeSummary(truncated!.original, truncated!.proposed)).toBe('words');
    // An older rewrite with a saved selection and no quote
    expect(rewriteWithoutProposal(comment('Selected text', undefined, 'Selected text'))).toEqual({ original: 'Selected text', proposed: 'Selected text' });
});
