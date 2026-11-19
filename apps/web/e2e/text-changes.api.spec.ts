import { expect, test } from '@playwright/test';
import { hasTextChanges, textChanges } from '@uier/toolbar/change-proposal';

// The word diff a saved suggestion shows against its original text (`@uier/toolbar/change-proposal`), in the app's
// thread and the toolbar's. The browser side is `rewrite-diff.spec.ts` and `rewrite.spec.ts`.

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

test('a suggestion that only changes spacing or line breaks changes no text', () => {
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
