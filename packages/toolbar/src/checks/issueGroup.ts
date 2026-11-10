import { anchorSelector } from '../anchorSelector';
import { commentTextMaxLength } from '../components/@types/Comments';
import { commentCheckCountMax } from '../feedbackTypes';
import { oneLine, pageAnchorElement } from './pageElements';
import type { IssueGroup, PageIssue } from './types';
import { messages } from '../i18n';

// One comment for several elements of a check or rule ("Comment on all" in the panels' lists,
// packages/toolbar/docs/page-checks-report.md): pinned to the first element, its text lists them all
// that fit, and the request names the check with how many it covers.

/**
 * The line every issue of a list shares, or nothing when they differ: said once (by the check's
 * reason, or under the rule's title) instead of on every element
 */
export function sharedSummary(issues: readonly PageIssue[]) {
    const first = issues[0]?.summary;
    return first !== undefined && issues.every(issue => issue.summary === first) ? first : undefined;
}

/** How a comment names the element: axe-core's selector, else the first of its anchor selectors (unique on the page), else its short name */
function issueSelector(issue: PageIssue) {
    const element = pageAnchorElement(issue.element);
    const selector = issue.selector ?? (element && anchorSelector(element).split(/(?<!\\),/)[0]) ?? issue.label ?? '';
    return `\`${oneLine(selector, 120).replaceAll('`', '\'')}\``;
}

/** What else the issue's comment says it found on the element ("Heading: `Plans`"), on one line; axe-core's are long failure lines */
function foundDetails(issue: PageIssue) {
    if (issue.check.type === 'accessibility') return '';
    // The element is on the list already: its line ("Element: `...`", in the language the comment was written in) is left out
    const element = `${messages().found.element}:`;
    const details = issue.comment.split('\n').slice(1).filter(line => /^[^:`\n]{1,40}: `.*`$/.test(line) && !line.startsWith(element)).join(', ');
    return details.length <= 300 ? details : '';
}

/**
 * The issue that stands for several (at least two) of a list's: pinned to the first one's element,
 * its comment lists their elements, as many as fit the API's 1000 characters ("and 4 more" after
 * them), between the group's first and last lines; its check carries how many it covers. `of`: how
 * many the list has, when some of them were reported before.
 */
export function groupIssue(issues: readonly PageIssue[], group: IssueGroup, of = issues.length): PageIssue {
    const t = messages().checks.group;
    const first = issues[0]!;
    const shared = sharedSummary(issues);
    const head = `${group.head}${shared && !group.summarized && !group.head.includes(shared) ? `\n${shared}` : ''}\n${issues.length < of
        ? t.notReported(issues.length, of) : t.elements(issues.length)}`;
    const foot = group.foot ? `\n\n${group.foot}` : '';
    let text = head;
    for (const [index, issue] of issues.entries()) {
        const details = foundDetails(issue);
        const line = `\n- ${issueSelector(issue)}${shared ? '' : `: ${issue.summary}`}${details ? ` ${details}` : ''}`;
        const left = issues.length - index - 1;
        // Room is kept for the line that says how many more there are
        if (text.length + line.length + (left ? `\n- ${t.more(left)}`.length : 0) + foot.length > commentTextMaxLength) {
            text += `\n- ${t.more(issues.length - index)}`;
            break;
        }
        text += line;
    }
    return {
        key: `${first.key}+${issues.length}`,
        summary: t.summary(issues.length),
        comment: `${text}${foot}`,
        path: first.path,
        check: { ...first.check, count: Math.min(issues.length, commentCheckCountMax) },
        element: first.element,
        label: first.label,
        selector: first.selector,
        ...first.review ? { review: true } : {}
    };
}
