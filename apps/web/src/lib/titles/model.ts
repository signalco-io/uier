import { createHash } from 'node:crypto';
import type { DbAiTitle, DbComment } from '../db/schema';

/** Longest title kept; a longer one is discarded, never cut */
export const AI_TITLE_MAX_LENGTH = 80;

/** Identifies the first message's text a title was made from, without storing the text again */
export function aiTitleSource(text: string) {
    return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

function firstItem(comment: Pick<DbComment, 'thread'>) {
    return Array.isArray(comment.thread?.items) ? comment.thread.items[0] : undefined;
}

/** The version of {@link cleanAiTitle} a new title passes through (`DbAiTitle.cleanup`) */
export const AI_TITLE_CLEANUP = 2;

/**
 * Titles made before quotes that belong to the title were kept (no `cleanup`) lost a leading or
 * final quote (`C" shortcut opens …`). One with unbalanced quotes is treated as missing, so the
 * next list render makes it again (bounded like any other missing title).
 */
function lostQuote(title: DbAiTitle) {
    if (title.cleanup) return false;
    const count = (pattern: RegExp) => title.text.match(pattern)?.length ?? 0;
    return count(/"/gu) % 2 === 1 || count(/“/gu) !== count(/”/gu) || count(/«/gu) !== count(/»/gu);
}

/**
 * The stored title while it still describes the first message: none once that message was
 * edited (until a new one is made) or deleted. A title is only as visible as the first message:
 * callers show it only on threads the viewer can see.
 */
export function currentAiTitle(comment: Pick<DbComment, 'thread' | 'aiTitle'>) {
    const first = firstItem(comment);
    const title = comment.aiTitle;
    if (!first || first.deletedAt || !first.text || !title?.text || typeof title.source !== 'string' || lostQuote(title))
        return undefined;
    return title.source === aiTitleSource(first.text) ? title.text : undefined;
}

/** The title to show: none while titles are off for the project */
export function visibleAiTitle(comment: Pick<DbComment, 'thread' | 'aiTitle'>, enabled: boolean) {
    return enabled ? currentAiTitle(comment) : undefined;
}

/** A thread whose first message has text and no current title */
export function needsAiTitle(comment: Pick<DbComment, 'thread' | 'aiTitle'>) {
    const first = firstItem(comment);
    return Boolean(first && !first.deletedAt && first.text?.trim()) && !currentAiTitle(comment);
}

// Bidirectional controls, other format characters and controls (line breaks included) become spaces
const invisible = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const visibleCharacter = /[^\p{White_Space}\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;
/** Opening quote to its closing ones */
const quotePairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '»': '«', '„': '“”', '‚': '‘’', '`': '`', '‹': '›', '「': '」' };

/**
 * Quotes around the whole title, as one pair (`"Checkout fails"`), never quotes that belong to it:
 * `"C" shortcut opens "Send feedback"` starts and ends with a quote but keeps both.
 */
function withoutWrappingQuotes(title: string) {
    for (let i = 0; i < 3; i++) {
        const closing = quotePairs[title[0] ?? ''];
        const last = title.at(-1) ?? '';
        if (!closing || title.length < 2 || !closing.includes(last)) break;
        const inner = title.slice(1, -1);
        if (inner.includes(title[0]!) || [...closing].some(quote => inner.includes(quote))) break;
        title = inner.trim();
    }
    return title;
}

/**
 * A model's title as plain text on one line: whitespace collapsed, a "Title:" label, Markdown
 * heading or emphasis marks, one pair of quotes around the whole title and a final period
 * removed. `null` when nothing visible is left or it is longer than {@link AI_TITLE_MAX_LENGTH} characters.
 */
export function cleanAiTitle(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    let title = raw.replace(invisible, ' ').replace(/\s+/gu, ' ').trim()
        .replace(/^title\s*:\s*/iu, '')
        .replace(/^#+\s*/u, '')
        .replace(/^(\*\*|__)(.*)\1$/u, '$2')
        .trim();
    title = withoutWrappingQuotes(title);
    if (/[^.]\.$/u.test(title)) title = title.slice(0, -1).trimEnd();
    if (!visibleCharacter.test(title) || Array.from(title).length > AI_TITLE_MAX_LENGTH)
        return null;
    return title;
}
