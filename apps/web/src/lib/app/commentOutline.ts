/**
 * The outline of what a list/board summary leaves out of a thread (uier #385): counts and sizes only, never text, so
 * the open thread's loading shell (`CommentCardShell`) has its shape. Pure and safe for the browser; the server
 * encodes it (`projectCommentPages.ts`), the shell decodes it.
 *
 * Messages are written as short tokens, separated by spaces:
 * - `12`: a line of 12 characters, `0` a blank line (a paragraph break), `1*100` a hundred lines of one character;
 * - `~199/100`: when the lines do not fit, 199 characters over 100 lines;
 * - `i800x600` the image's size, `r3` three reactions, `a` the viewer has its More actions menu, `d` deleted.
 * Replies are separated by `;`. The whole thread's replies take at most `outlineBudget` characters: a reply that does not
 * fit in detail is written in totals, and the replies past the budget become one `+12/40` (twelve more replies, forty
 * lines between them, drawn as typical lines), so a thread's outline stays under 200 bytes however long its discussion
 * (`project-paging-benchmark.api.spec.ts` checks the list and board budgets with long multiline discussions).
 */

/** Characters for the whole thread's replies; the first message's rest has `restBudget` */
export const outlineBudget = 96;
export const restBudget = 20;
/** Room kept for the closing `+n/l` token */
export const tailRoom = 10;

export type OutlineMessage = {
    /** Each line's length, 0 for a blank line */
    lines: number[];
    deleted?: boolean;
    image?: { width: number; height: number };
    reactions?: number;
    /** The viewer has its More actions menu (edit, delete or more from its author) */
    actions?: boolean;
};

/** A message as the summary knows it: its text as shown and what goes beside it */
export type OutlineSource = { text: string; deleted?: boolean; image?: { width: number; height: number }; reactions?: number; actions?: boolean };

const lineLengths = (text: string) => text.split('\n').map(line => line.trim() ? line.length : 0);

/** The lines, equal neighbours as `length*count` */
function runs(lines: number[]) {
    const tokens: string[] = [];
    for (let index = 0; index < lines.length;) {
        let end = index + 1;
        while (end < lines.length && lines[end] === lines[index]) end++;
        tokens.push(end - index > 1 ? `${lines[index]}*${end - index}` : `${lines[index]}`);
        index = end;
    }
    return tokens.join(' ');
}

/** What goes beside the text, then the text in detail and in totals */
function message(source: OutlineSource) {
    if (source.deleted) return { detail: 'd', coarse: 'd', lines: 0 };
    const lines = lineLengths(source.text);
    const extras = [source.image && source.image.width > 0 && source.image.height > 0 ? `i${source.image.width}x${source.image.height}` : '',
        source.reactions ? `r${source.reactions}` : '', source.actions ? 'a' : ''].filter(Boolean).join(' ');
    const join = (text: string) => [text, extras].filter(Boolean).join(' ');
    const total = lines.reduce((sum, length) => sum + length, 0);
    return { detail: join(runs(lines)), coarse: join(lines.length > 1 ? `~${total}/${lines.length}` : `${total}`), lines: lines.length };
}

/** The replies in at most about `budget` characters (`outlineBudget`) */
export function encodeReplies(replies: OutlineSource[], budget = outlineBudget): string | undefined {
    const parts: string[] = [];
    let used = 0;
    const encoded = replies.map(message);
    for (let index = 0; index < encoded.length; index++) {
        const { detail, coarse } = encoded[index]!;
        // The last reply needs no room for a tail after it
        const room = budget - used - (index < encoded.length - 1 ? tailRoom : 0);
        const part = detail.length + 1 <= room ? detail : coarse.length + 1 <= room ? coarse : undefined;
        if (!part) {
            const rest = encoded.slice(index);
            parts.push(`+${rest.length}/${rest.reduce((sum, item) => sum + item.lines, 0)}`);
            break;
        }
        parts.push(part);
        used += part.length + 1;
    }
    return parts.length ? parts.join(';') : undefined;
}

/** The first message's text past what the summary keeps, in at most about `restBudget` characters */
export function encodeText(text: string, budget = restBudget): string | undefined {
    if (!text) return undefined;
    const { detail, coarse } = message({ text });
    return detail.length <= budget ? detail : coarse;
}

/** What it was left on: its kind's letter, the length of its selected text or selector, then its label (`t180 Selected text`) */
export function encodeAnchor(type: 'element' | 'area' | 'text' | 'page', label: string, size?: number) {
    return `${type[0]}${size ?? ''} ${label.slice(0, 120)}`;
}

export function decodeAnchor(value: string | undefined): { type: 'element' | 'area' | 'text' | 'page'; label: string; size?: number } {
    const space = value?.indexOf(' ') ?? -1;
    const head = value && space > 0 ? value.slice(0, space) : '';
    const type = ({ e: 'element', a: 'area', t: 'text', p: 'page' } as const)[head[0] as 'e' | 'a' | 't' | 'p'] ?? 'page';
    return { type, label: value && space > 0 ? value.slice(space + 1) : '', size: head.length > 1 ? number(head.slice(1)) : undefined };
}

const number = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.floor(parsed), 10_000) : 0;
};

/** One message's tokens back as its lines and what goes beside them */
export function decodeMessage(value: string): OutlineMessage {
    const result: OutlineMessage = { lines: [] };
    for (const token of value.split(' ').filter(Boolean)) {
        if (token === 'd') result.deleted = true;
        else if (token === 'a') result.actions = true;
        else if (token.startsWith('r')) result.reactions = number(token.slice(1));
        else if (token.startsWith('i')) {
            const [width, height] = token.slice(1).split('x');
            result.image = { width: number(width), height: number(height) };
        } else if (token.startsWith('~')) {
            const [total, count] = token.slice(1).split('/').map(number);
            const lines = Math.max(1, count ?? 1);
            result.lines.push(...Array.from({ length: lines }, () => Math.max(1, Math.round((total ?? 0) / lines))));
        } else {
            const [length, count] = token.split('*');
            result.lines.push(...Array.from({ length: count === undefined ? 1 : Math.min(number(count), 1000) }, () => number(length)));
        }
    }
    return result;
}

/** The replies back, one each; `+n/l` stands for n replies sharing l lines (at least one each) */
export function decodeReplies(value: string | undefined): OutlineMessage[] {
    if (!value) return [];
    return value.split(';').flatMap(part => {
        if (!part.startsWith('+')) return [decodeMessage(part)];
        const [count, lines] = part.slice(1).split('/').map(number);
        const replies = Math.min(count ?? 0, 1000);
        return Array.from({ length: replies }, (_, index) => {
            const share = Math.max(1, Math.floor((lines ?? 0) / replies) + (index < (lines ?? 0) % replies ? 1 : 0));
            // A typical line's length: the room is what is reserved, not the words
            return { lines: Array.from({ length: share }, () => 40) };
        });
    });
}
