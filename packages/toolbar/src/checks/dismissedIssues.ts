import { runtimeAdapters } from '../adapters';
import { anchorSelector } from '../anchorSelector';
import { toolbarConfig } from '../config';
import { pageAnchorElement } from './pageElements';
import type { PageIssue } from './types';

// Findings a reviewer marked "Not an issue" (packages/toolbar/docs/page-checks-report.md): kept in
// this browser only, in the reviewed site's storage (scoped by API and project like the toolbar's
// other keys), in memory where storage is blocked. Bounded, oldest first out, and they expire.

const storagePrefix = 'uier:checks-dismissed:v1:';
export const dismissedLimit = 300;
export const dismissedLifetimeMs = 90 * 24 * 60 * 60 * 1000;

/** Each dismissed finding's identity, with when it was dismissed */
export type Dismissed = ReadonlyMap<string, number>;

const memory = new Map<string, Dismissed>();
const storage = () => runtimeAdapters()?.draftStorage ?? localStorage;

/** This API's and project's key (with the site's origin in a packaged client, whose storage every site shares) */
function storageKey() {
    return `${storagePrefix}${JSON.stringify([toolbarConfig.apiUrl, toolbarConfig.project ?? 'public', ...runtimeAdapters() ? [location.origin] : []])}`;
}

/** Only well-formed entries of the last 90 days, the newest `dismissedLimit` of them */
function bounded(entries: Iterable<[unknown, unknown]>): Dismissed {
    const now = Date.now();
    const kept = [...entries].filter((entry): entry is [string, number] => typeof entry[0] === 'string' && entry[0].length <= 64
        && typeof entry[1] === 'number' && entry[1] > now - dismissedLifetimeMs && entry[1] <= now + 60_000);
    return new Map(kept.sort((a, b) => a[1] - b[1]).slice(-dismissedLimit));
}

/** What this browser dismissed for this project */
export function readDismissed(): Dismissed {
    const key = storageKey();
    const kept = memory.get(key);
    if (kept) return kept;
    let read: Dismissed = new Map();
    try {
        const raw = storage().getItem(key);
        const parsed: unknown = raw && raw.length <= 64_000 ? JSON.parse(raw) : undefined;
        if (Array.isArray(parsed)) read = bounded(parsed.filter(Array.isArray) as [unknown, unknown][]);
    } catch { /* Blocked or unreadable: none */ }
    memory.set(key, read);
    return read;
}

/** Saves a finding as dismissed (`at`), or restores it (`undefined`); the new set */
export function writeDismissed(identity: string, at: number | undefined): Dismissed {
    const key = storageKey();
    const next = new Map(readDismissed());
    if (at === undefined) next.delete(identity);
    else next.set(identity, at);
    const value = bounded(next);
    memory.set(key, value);
    try {
        if (value.size) storage().setItem(key, JSON.stringify([...value]));
        else storage().removeItem(key);
    } catch { /* Blocked or full: kept in memory for this page */ }
    return value;
}

const selectors = new WeakMap<Element, string>();

/** A short, stable hash (32-bit FNV-1a) of part of a finding's identity, so an entry stays small whatever its selector */
function hash(text: string) {
    let value = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return (value >>> 0).toString(36);
}

/** The first part of a finding's identity: its check, whether it is one to review, and its page (cheap, so most findings need no selector) */
export function dismissedPrefix(issue: PageIssue): string | undefined {
    return issue.path === undefined ? undefined : hash(JSON.stringify([issue.check.type, issue.check.id, issue.review ? 'review' : '', issue.path]));
}

/**
 * A finding's identity across reloads: its check, whether it is one to review, its page, and its
 * element's anchor selector (the one comments are pinned with; not the per-session `elementKey`).
 * None for a measurement of the page as it is now (Core Web Vitals) or an element no longer there.
 */
export function dismissedIdentity(issue: PageIssue): string | undefined {
    const prefix = dismissedPrefix(issue);
    if (prefix === undefined) return undefined;
    let selector = '';
    if (issue.element) {
        const element = pageAnchorElement(issue.element);
        if (!element) return undefined;
        selector = selectors.get(element) ?? anchorSelector(element);
        selectors.set(element, selector);
    }
    return `${prefix}.${hash(selector)}`;
}
