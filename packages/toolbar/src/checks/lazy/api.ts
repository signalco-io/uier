import type { CommentCheck } from '../../feedbackTypes';
import { elementKey, elementLabel } from '../pageElements';
import type { CheckState, PageCheck, PageIssue } from '../types';

// What every on-demand check (`src/checks/lazy/*.ts`, in the audit asset) is given and gives back.
// Types and two small builders only: this file is in both bundles.

/** The page being checked, and the signal that says nobody waits for the report any more */
export type SectionContext = { path: string; signal: AbortSignal };

/**
 * What a section of a panel found: its checks (one compact row each, like the SEO panel's), and
 * whatever its own view shows beyond them (`details`: plain data and page elements)
 */
export type SectionReport<Details = undefined> = {
    checks: PageCheck[];
    /** The count beside the section's title (links, images) */
    count?: number;
    /** A short note on the right of the section's title */
    note?: string;
    details?: Details;
};

/** A check's row: its state, name and one-line reason, with what was found, a measurement and its issues */
export function pageCheck(id: string, label: string, state: CheckState, reason: string,
    more: { value?: string; measure?: string; issues?: PageIssue[]; group?: PageCheck['group'] } = {}): PageCheck {
    return { id, label, state, reason, value: more.value, measure: more.measure, issues: more.issues ?? [], ...more.group ? { group: more.group } : {} };
}

/**
 * Something a check found, which one click turns into a comment. Its key is stable for the same
 * finding on the same element and ends with the page's path, so a posted comment stays marked and
 * the same finding on another page can be reported again. `comment` is the comment's whole text,
 * within the API's 1000 characters: what was found and where (`foundLine`, `writtenAddress`).
 */
export function pageIssue(path: string, check: CommentCheck, element: Element | undefined, summary: string, comment: string): PageIssue {
    return {
        key: `${check.type}:${check.id}:${element ? elementKey(element) : 'page'}@${path}`,
        summary, comment, path, check, element, label: element && elementLabel(element)
    };
}
