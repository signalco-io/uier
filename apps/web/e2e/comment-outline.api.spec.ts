import { expect, test } from '@playwright/test';
import { decodeAnchor, decodeMessage, decodeReplies, encodeAnchor, encodeReplies, encodeText, outlineBudget, restBudget, tailRoom } from '../src/lib/app/commentOutline';

// The loading shell's outline of a thread (uier #385): exact lines while they fit, a few hundred bytes at most a thread.

test('a reply keeps every line break, equal lines run-length encoded', () => {
    const lines = Array.from({ length: 100 }, () => 'x').join('\n');
    expect(lines.length).toBe(199);
    expect(encodeReplies([{ text: lines }])).toBe('1*100');
    expect(decodeReplies('1*100')[0]!.lines).toHaveLength(100);
    const paragraphs = 'Steps to reproduce:\nOpen the pricing page\n\nNothing happens.';
    expect(decodeReplies(encodeReplies([{ text: paragraphs, reactions: 2, actions: true, image: { width: 800, height: 600 } }]))).toEqual([
        { lines: [19, 21, 0, 16], reactions: 2, actions: true, image: { width: 800, height: 600 } }
    ]);
    expect(decodeReplies(encodeReplies([{ text: '', deleted: true }, { text: 'Reply' }]))).toEqual([{ lines: [], deleted: true }, { lines: [5] }]);
});

test('a long discussion stays within the thread budget and keeps its reply count and line count', () => {
    // Lines of varying length defeat run-length encoding: 40 lines in 79 characters, and 1000-character replies
    const varied = Array.from({ length: 40 }, (_, line) => 'x'.repeat(1 + line % 3)).join('\n');
    const long = Array.from({ length: 400 }, (_, line) => 'x'.repeat(1 + line % 2)).join('\n').slice(0, 1000);
    const replies = Array.from({ length: 49 }, (_, index) => ({ text: index % 2 ? long : varied, reactions: 6, actions: true, image: { width: 4096, height: 4096 } }));
    const encoded = encodeReplies(replies)!;
    expect(encoded.length).toBeLessThanOrEqual(outlineBudget + tailRoom);
    const decoded = decodeReplies(encoded);
    expect(decoded).toHaveLength(49);
    // Totals stand in for the detail that does not fit: the first reply keeps all 40 of its lines
    expect(decoded[0]!.lines).toHaveLength(40);
    expect(decodeAnchor(encodeAnchor('text', 'Selected text', 180))).toEqual({ type: 'text', label: 'Selected text', size: 180 });
    expect(decodeAnchor(encodeAnchor('page', 'Whole page'))).toEqual({ type: 'page', label: 'Whole page', size: undefined });
    const rest = encodeText(long)!;
    expect(rest.length).toBeLessThanOrEqual(restBudget);
    expect(decodeMessage(rest).lines.length).toBe(long.split('\n').length);
});
