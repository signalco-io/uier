/** A check's result: passed, worth a look, or nothing to say yet (not measured, not supported) */
export type CheckState = 'pass' | 'warn' | 'none';

/** Something a panel found, which one click turns into a comment (`useIssueComment`) */
export type PageIssue = {
    /** Stable for the same finding on the same element, so a posted comment stays marked */
    key: string;
    /** One line in the panel */
    summary: string;
    /** The comment's text */
    comment: string;
    /** The element it is about (pinned there); without one the comment is about the page */
    element?: Element;
    /** The element's short name in the panel (`img#hero.logo`) */
    label?: string;
};

/** One line of a panel: a check with its state, value and one-line reason */
export type PageCheck = {
    id: string;
    label: string;
    state: CheckState;
    /** What was found (the title, a count, a measurement) */
    value?: string;
    reason: string;
    issues: PageIssue[];
};
