import { getToolbarHost } from '../mount';
import { loadAudit, loadAxe } from './axeLoader';
import type { AxeApi } from './auditHandoff';
import type { Impact } from './axeRules';
import type { IssueGroup, PageIssue } from './types';

// The Accessibility panel's audit: every axe-core rule that runs by default (WCAG A and AA, and
// best practices) and WCAG 2.2's target size on the page's document, without the toolbar's shadow
// root and inline threads. What axe-core could not decide is kept apart, for a person to judge. The
// audit itself is in the audit asset beside axe-core (`lazy/accessibilityReport.ts`); this is its
// queue, in the review bundle.

export { impacts, ruleStandard, type Impact } from './axeRules';

export type AccessibilityRule = {
    id: string;
    impact: Impact;
    /** What the rule asks for, in a few words ("Images must have alternative text") */
    help: string;
    helpUrl?: string;
    /** The WCAG success criteria and level it tests ("WCAG 1.4.3 (AA)"), or "Best practice" */
    standard?: string;
    issues: PageIssue[];
    /** What axe-core could not decide on these elements (its incomplete results): to review, not issues */
    review?: boolean;
    /** The words of one comment about several of its elements */
    group?: IssueGroup;
    /** Its elements marked "Not an issue" in this browser, out of `issues` (set by `PageChecks`) */
    dismissed?: PageIssue[];
};

export type AccessibilityReport = {
    path: string;
    checkedAt: number;
    rules: AccessibilityRule[];
    /** Every element of every rule */
    count: number;
    /** What axe-core could not decide (contrast over an image or a gradient): for a person to judge, never counted */
    review?: AccessibilityRule[];
};

let previous: Promise<unknown> = Promise.resolve();

/**
 * Loads axe-core (the lazy audit asset) and checks the page. axe-core runs one audit at a time:
 * a check asked for while one runs waits for it and then checks the page as it is now, so a panel
 * that stays open after a navigation never gets the previous page's report. A cancelled check
 * (`signal`) rejects at once and, once its turn comes, neither loads axe-core nor runs it; a step
 * already running ends first. `background`: the unasked audit, in short steps when the browser is
 * idle, `undefined` when the page is too large or a step too slow for it (`auditInSteps`).
 */
export function checkAccessibility(path: string, options?: { signal?: AbortSignal }): Promise<AccessibilityReport>;
export function checkAccessibility(path: string, options: { signal?: AbortSignal; background: BackgroundAudit }): Promise<AccessibilityReport | undefined>;
export function checkAccessibility(path: string, { signal, background }: { signal?: AbortSignal; background?: BackgroundAudit } = {}) {
    const audit = previous.catch(() => undefined).then(async () => {
        // A cancelled audit (its page left, the toolbar collapsed or closed, a newer audit asked for) does nothing
        signal?.throwIfAborted();
        // Unasked, a page too large to check in short steps is left to the panel (before any download)
        if (background && !background.hurry?.() && document.getElementsByTagName('*').length > backgroundElementLimit) return undefined;
        const { axe, checks } = await loadAudit();
        signal?.throwIfAborted();
        return checks.accessibilityReport.auditPage(axe, path, auditExcluded(), { signal, steps: background && !background.hurry?.(), hurry: background?.hurry });
    });
    previous = audit;
    if (!signal) return audit;
    // A cancelled audit's owner hears of it at once; the queue still waits for the step that runs
    return Promise.race([audit, new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })]);
}

/** The review layer is not the page: its host (wherever the page's layers moved it) and inline threads are left out of every audit */
export function auditExcluded(): Element[] {
    return [getToolbarHost(), ...document.querySelectorAll('[data-uier-thread]')].filter(node => node instanceof Element);
}

/**
 * Runs `task` with axe-core once the audits asked for before it ended, and holds the ones asked for
 * after it until it ends: axe-core does one thing at a time (`axe.run`, and `axe.setup` for its
 * virtual tree, refuse to start while another runs). For work beside the panel's audit: one rule on
 * one element, or a check that needs axe-core's own helpers. A cancelled task (`signal`) does not start.
 */
export function withAxe<T>(task: (axe: AxeApi) => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    const run = previous.catch(() => undefined).then(async () => {
        signal?.throwIfAborted();
        const axe = await loadAxe();
        signal?.throwIfAborted();
        return task(axe);
    });
    previous = run;
    return run;
}

/** The audit nobody asked for yet: `hurry` says the panel waits for it now (no idle waits, no limits) */
export type BackgroundAudit = { hurry?: () => boolean };

/**
 * The background audit's bound: its steps scale with the document, and over this many elements it
 * is not run unasked (the panel and Check again still check the page)
 */
export const backgroundElementLimit = 1_500;
