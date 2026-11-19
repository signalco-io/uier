/** One run of a word diff: kept, removed from the original, or added by the suggestion */
export type TextChange = { type: 'same' | 'removed' | 'added'; text: string };

/** A word (with its apostrophes) or one other visible character, and the whitespace before it */
const tokenPattern = /(\s*)([\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|\S)/gu;
/** Past this many comparisons, the changed middle shows as one removal and one addition */
const maxComparisons = 250_000;

type Token = { space: string; word: string };

function tokens(text: string): { list: Token[]; trailing: string } {
    const list: Token[] = [];
    let end = 0;
    for (const match of text.matchAll(tokenPattern)) {
        list.push({ space: match[1]!, word: match[2]! });
        end = match.index + match[0].length;
    }
    return { list, trailing: text.slice(end) };
}

/**
 * What a suggestion changes in the original, word by word. Only the words count: a difference in spacing or
 * line breaks alone is no change. Kept runs use the suggestion's spacing; a changed run is its removed words,
 * then its added words.
 */
export function textChanges(original: string, proposed: string): TextChange[] {
    const { list: a } = tokens(original);
    const { list: b, trailing } = tokens(proposed);
    let start = 0;
    while (start < a.length && start < b.length && a[start]!.word === b[start]!.word) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1]!.word === b[endB - 1]!.word) { endA--; endB--; }

    // A kept word is the suggestion's, with the space the original has before it
    type Step = { type: 'removed' | 'added'; token: Token } | { type: 'same'; token: Token; originalSpace: string };
    const kept = (from: number, to: number, offset: number): Step[] =>
        b.slice(from, to).map((token, index) => ({ type: 'same', token, originalSpace: a[from + offset + index]!.space }));
    const steps: Step[] = kept(0, start, 0);
    const n = endA - start;
    const m = endB - start;
    if (n * m > maxComparisons) {
        steps.push(...a.slice(start, endA).map(token => ({ type: 'removed' as const, token })),
            ...b.slice(start, endB).map(token => ({ type: 'added' as const, token })));
    } else {
        // The longest common run of words from each position to the end
        const width = m + 1;
        const common = new Uint16Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--)
            for (let j = m - 1; j >= 0; j--)
                common[i * width + j] = a[start + i]!.word === b[start + j]!.word
                    ? common[(i + 1) * width + j + 1]! + 1
                    : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
        let i = 0;
        let j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && a[start + i]!.word === b[start + j]!.word) {
                steps.push({ type: 'same', token: b[start + j]!, originalSpace: a[start + i]!.space });
                i++;
                j++;
            } else if (j >= m || (i < n && common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) {
                steps.push({ type: 'removed', token: a[start + i]! });
                i++;
            } else {
                steps.push({ type: 'added', token: b[start + j]! });
                j++;
            }
        }
    }
    steps.push(...kept(endB, b.length, endA - endB));

    const changes: TextChange[] = [];
    const add = (type: TextChange['type'], text: string) => {
        if (!text) return;
        const last = changes.at(-1);
        if (last?.type === type) last.text += text;
        else changes.push({ type, text });
    };
    let removed: Token[] = [];
    let added: Token[] = [];
    /** The run of changes before a kept word, and the space to keep before that word */
    const flush = (next?: Extract<Step, { type: 'same' }>) => {
        let space = next?.token.space ?? '';
        if (!removed.length && !added.length) return space;
        // The space both sides have before a replacement stays outside it, so it is never struck through or underlined.
        // An addition or removal alone keeps its space, so each side still reads with its own spacing.
        const first = removed[0]?.space ?? '';
        const other = added[0]?.space;
        let shared = 0;
        if (removed.length && added.length)
            while (shared < first.length && other?.[shared] === first[shared]) shared++;
        const run = (list: Token[]) => list.map((token, index) => (index ? token.space : token.space.slice(shared)) + token.word).join('');
        // Each side keeps its own space before the next kept word, so the original reads as written
        const after = removed.length && next && next.originalSpace !== next.token.space;
        add('same', first.slice(0, shared));
        add('removed', run(removed) + (after ? next.originalSpace : ''));
        add('added', run(added) + (after && added.length ? space : ''));
        if (after && added.length) space = '';
        removed = [];
        added = [];
        return space;
    };
    for (const step of steps) {
        if (step.type === 'removed') removed.push(step.token);
        else if (step.type === 'added') added.push(step.token);
        else if (step.type === 'same') add('same', flush(step) + step.token.word);
    }
    flush();
    add('same', trailing);
    return changes;
}

/** The suggestion changes at least one word of the original */
export function hasTextChanges(changes: readonly TextChange[]): boolean {
    return changes.some(change => change.type !== 'same');
}
