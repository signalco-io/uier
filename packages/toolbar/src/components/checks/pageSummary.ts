import { impacts, type AccessibilityReport } from '../../checks/accessibility';
import type { SeoReport } from '../../checks/seo';
import type { PageCheck } from '../../checks/types';
import type { WebVitals } from '../../checks/webVitals';
import { oneLine } from '../../checks/pageElements';
import { toolbarConfig } from '../../config';
import { apiRequest, CommentsApiError } from '../../hooks/api';
import { reviewApiUrl } from '../../project/ProjectGate';

// One page's summary for the project's Page checks view in the app (docs/page-checks-site.md): the
// counts, the checks' states and the page's title and description, never an element, page text or the
// reviewer. `POST /api/review/<project>/page-checks` (docs/api.md, "Page checks").

export type PageSummary = {
    path: string;
    sourcePath?: string;
    title?: string;
    description?: string;
    noindex: boolean;
    accessibility?: Record<(typeof impacts)[number], number>;
    seo: { warn: number; pass: number };
    checks: Record<string, PageCheck['state']>;
    vitals?: { lcp?: number; cls?: number; inp?: number };
};

const maxChecks = 150;
const checkId = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Plain text on one line, capped like the API's limits */
const text = (value: string | undefined, max: number) => oneLine(value?.replace(/\p{Cc}/gu, ' '), max) || undefined;

export function pageSummary({ path, sourcePath, accessibility, seo, seoChecks, accessibilityChecks, vitals }: {
    path: string;
    sourcePath?: string;
    accessibility?: AccessibilityReport;
    seo?: SeoReport;
    /** Every check the SEO panel counts: its own, Core Web Vitals and its sections' */
    seoChecks: readonly PageCheck[];
    /** The Accessibility panel's sections' checks */
    accessibilityChecks: readonly PageCheck[];
    vitals: WebVitals;
}): PageSummary {
    const checks: Record<string, PageCheck['state']> = {};
    const add = (panel: 'seo' | 'accessibility', id: string, state: PageCheck['state']) => {
        if (Object.keys(checks).length < maxChecks && checkId.test(id)) checks[`${panel}:${id}`] = state;
    };
    for (const check of seoChecks) add('seo', check.id, check.state);
    for (const rule of accessibility?.rules ?? []) add('accessibility', rule.id, 'warn');
    for (const check of accessibilityChecks) add('accessibility', check.id, check.state);
    const page = (id: string) => seo?.page.find(check => check.id === id);
    // Only what was measured: milliseconds, and the layout shift score to three places
    const measured = Object.fromEntries(([['lcp', vitals.LCP.value, 1], ['cls', vitals.CLS.value, 1000], ['inp', vitals.INP.value, 1]] as const)
        .flatMap(([name, value, scale]) => value === undefined || !Number.isFinite(value) ? [] : [[name, Math.round(value * scale) / scale]]));
    const tally = (state: PageCheck['state']) => seoChecks.filter(check => check.state === state).length;
    return {
        path,
        ...(sourcePath && sourcePath !== path ? { sourcePath } : {}),
        title: text(page('title')?.value, 200),
        description: text(page('description')?.value, 300),
        // The Indexing check is a note only when the page asks not to be indexed
        noindex: page('robots')?.state === 'none',
        ...(accessibility ? {
            accessibility: Object.fromEntries(impacts.map(impact => [impact,
                accessibility.rules.filter(rule => rule.impact === impact).reduce((total, rule) => total + rule.issues.length, 0)])) as PageSummary['accessibility']
        } : {}),
        seo: { warn: tally('warn'), pass: tally('pass') },
        checks,
        ...(Object.keys(measured).length ? { vitals: measured } : {})
    };
}

/** JSON with sorted keys, so the same summary always reads the same */
function canonical(value: unknown): string {
    if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/**
 * What decides whether the page's summary changed: everything but the vitals' exact values (whether
 * they are over their targets is in the SEO counts), so a reviewer using the page doesn't send it again and again
 */
export function summarySignature(summary: PageSummary) {
    const { vitals: _vitals, ...rest } = summary;
    const json = canonical(rest);
    // FNV-1a: a short fingerprint for the browser's record, not a security measure
    let hash = 0x811c9dc5;
    for (let index = 0; index < json.length; index++) hash = Math.imul(hash ^ json.charCodeAt(index), 0x01000193) >>> 0;
    return hash.toString(36);
}

// What this browser sent for each page of the project, so an unchanged page is not sent again: the
// signature and when (`f` when it failed). In the reviewed site's local storage, without names, ids or
// tokens; in memory where storage is blocked.
const storageKey = `uier:page-checks:v1:${toolbarConfig.apiUrl}:${toolbarConfig.project ?? ''}`;
type Sent = Record<string, { s: string; t: number; f?: 1 }>;
const resendAfterMs = 24 * 60 * 60 * 1000;
const retryAfterMs = 60 * 60 * 1000;
const maxPages = 100;
let memory: Sent = {};
/** Signatures sent or being sent in this document, by page: never twice */
const attempted = new Map<string, string>();
/** After a rate limit, nothing is sent until then */
let pausedUntil = 0;

function readSent(): Sent {
    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Sent : {};
    } catch {
        return memory;
    }
}

function recordSent(path: string, signature: string, failed: boolean) {
    const now = Date.now();
    const entries = Object.entries({ ...readSent(), [path]: { s: signature, t: now, ...(failed ? { f: 1 as const } : {}) } })
        .filter(([, entry]) => typeof entry?.t === 'number' && now - entry.t < resendAfterMs)
        .sort(([, a], [, b]) => b.t - a.t)
        .slice(0, maxPages);
    memory = Object.fromEntries(entries);
    try { window.localStorage.setItem(storageKey, JSON.stringify(memory)); } catch { /* Kept in memory for this page. */ }
}

/** Whether the page's summary still needs sending: it changed since this browser last sent it, or a day passed (an hour after a failure) */
export function needsSending(path: string, signature: string) {
    if (Date.now() < pausedUntil || attempted.get(path) === signature) return false;
    const last = readSent()[path];
    return !last || last.s !== signature || Date.now() - last.t >= (last.f ? retryAfterMs : resendAfterMs);
}

/** Sends the summary once; a failure is quiet (the next visit of the page tries again) */
export async function sendPageSummary(summary: PageSummary) {
    const signature = summarySignature(summary);
    if (!needsSending(summary.path, signature)) return;
    attempted.set(summary.path, signature);
    try {
        await apiRequest(`${reviewApiUrl}/page-checks`, { method: 'POST', body: summary });
        recordSent(summary.path, signature, false);
    } catch (error) {
        if (error instanceof CommentsApiError && error.code === 'rate_limited') pausedUntil = Date.now() + (error.retryAfter ?? 3600) * 1000;
        recordSent(summary.path, signature, true);
    }
}
