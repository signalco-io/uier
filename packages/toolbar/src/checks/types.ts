/** A check's result: passed, worth a look, or a note without a verdict (not measured, not supported, not needed, a noindex page) */
export type CheckState = 'pass' | 'warn' | 'none';

/** Something a panel found, which one click turns into a comment (`useIssueComment`) */
export type PageIssue = {
    /** Stable for the same finding on the same element, so a posted comment stays marked */
    key: string;
    /** One line in the panel */
    summary: string;
    /** The comment's text: what was found and where, within the API's text limit */
    comment: string;
    /** The page it was found on; none for a measurement of the page as it is now (Core Web Vitals) */
    path?: string;
    /** The check it comes from, saved with the comment */
    check: import('../feedbackTypes').CommentCheck;
    /** The element it is about (pinned there); without one the comment is about the page */
    element?: Element;
    /** The element's short name in the panel (`img#hero.logo`) */
    label?: string;
    /** How a comment names the element when it is one of several (axe-core's selector); else its first anchor selector */
    selector?: string;
    /** Something a person has to judge (what axe-core could not decide): listed, never counted as an issue */
    review?: boolean;
};

/**
 * The words of one comment about several elements of a check or rule ("Comment on all"): the first
 * line, and the last (the standard and the rule's page). The elements are listed between them, after
 * the line they all share unless the first line says it (`summarized`: a check's reason).
 */
export type IssueGroup = { head: string; foot?: string; summarized?: boolean };

/** One line of a panel: a check with its state, value and one-line reason */
export type PageCheck = {
    id: string;
    label: string;
    state: CheckState;
    /** What was found (the title, the canonical address), on its own line */
    value?: string;
    /** A short measurement beside the label ("2.1 s") */
    measure?: string;
    reason: string;
    issues: PageIssue[];
    /** Its issues marked "Not an issue" in this browser, out of `issues` (set by `PageChecks`; a check with only these is a note) */
    dismissed?: PageIssue[];
};
