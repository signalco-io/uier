import type { ImpactValue, Result } from 'axe-core';
import { getToolbarHost } from '../mount';
import { loadAxe } from './axeLoader';
import { commentTextMaxLength } from '../components/@types/Comments';
import { commentCheckIdPattern } from '../feedbackTypes';
import { elementKey, elementLabel, foundLine, oneLine, pageAnchorElement } from './pageElements';
import type { PageIssue } from './types';

// The Accessibility panel's audit: every axe-core rule that runs by default (WCAG A and AA, and
// best practices) on the page's document, without the toolbar's shadow root and inline threads.

export type Impact = Exclude<ImpactValue, null>;
export const impacts: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

export type AccessibilityRule = {
    id: string;
    impact: Impact;
    /** What the rule asks for, in a few words ("Images must have alternative text") */
    help: string;
    helpUrl?: string;
    /** The WCAG success criteria and level it tests ("WCAG 1.4.3 (AA)"), or "Best practice" */
    standard?: string;
    issues: PageIssue[];
};

export type AccessibilityReport = {
    path: string;
    checkedAt: number;
    rules: AccessibilityRule[];
    /** Every element of every rule */
    count: number;
};

/** The rule's page on Deque University, without its tracking query */
function ruleLink(url: string | undefined) {
    try {
        const link = new URL(url ?? '');
        if (link.protocol !== 'https:') return undefined;
        link.search = '';
        return link.href;
    } catch {
        return undefined;
    }
}

/**
 * What a rule tests, from axe-core's tags: its WCAG success criteria (`wcag143` is 1.4.3) with the
 * level (`wcag2aa`, `wcag21aa`, `wcag22aa`), or "Best practice" for a rule outside WCAG
 */
export function ruleStandard(tags: readonly string[]): string | undefined {
    const criteria = tags.flatMap(tag => {
        const digits = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
        return digits ? [`${digits[1]}.${digits[2]}.${digits[3]}`] : [];
    });
    const level = tags.map(tag => /^wcag2[12]?(a{1,3})$/.exec(tag)?.[1]).find(Boolean)?.toUpperCase();
    if (criteria.length || level) return `WCAG${criteria.length ? ` ${criteria.join(', ')}` : ''}${level ? criteria.length ? ` (${level})` : ` ${level}` : ''}`;
    return tags.includes('best-practice') ? 'Best practice' : undefined;
}

const fixHeading = /^Fix (any|all) of the following:?$/i;

/** axe-core's failure summary of one element as Markdown lines: its "Fix any of the following:" headings, each failure a list item */
function failureLines(summary: string | undefined) {
    return (summary ?? '').split('\n').map(line => line.trim()).filter(Boolean)
        .map(line => fixHeading.test(line) ? line : `- ${oneLine(line, 300)}`);
}

/**
 * The comment of one element's issue: the rule, the element, what axe-core measured on it (the
 * contrast ratio, the missing attribute), then the standard and the rule's page. Failure lines that
 * would pass the API's text limit are left out; the rule's page has them all.
 */
function commentText(head: string, failures: string[], foot: string) {
    const kept: string[] = [];
    // The blank line before the foot ends the list
    let length = head.length + foot.length + 2;
    for (const line of failures) {
        if (length + line.length + 1 > commentTextMaxLength) break;
        kept.push(line);
        length += line.length + 1;
    }
    // A heading whose failures were all left out says nothing
    while (kept.length && fixHeading.test(kept.at(-1)!)) kept.pop();
    return kept.length ? `${head}\n${kept.join('\n')}\n\n${foot}` : `${head}\n${foot}`;
}

/** Issue keys end with the page's path, so a comment posted on one page doesn't mark the same finding on another */
function ruleOf(result: Result, path: string): AccessibilityRule {
    const impact = impacts.includes(result.impact as Impact) ? result.impact as Impact : 'minor';
    const help = oneLine(result.help, 200).replace(/\.$/, '');
    const helpUrl = ruleLink(result.helpUrl);
    const standard = ruleStandard(result.tags);
    const foot = `${standard ? `${standard}. ` : ''}Rule ${result.id}${helpUrl ? `: ${helpUrl}` : '.'}`;
    const issues = result.nodes.map((node, index): PageIssue => {
        const found = node.element ?? undefined;
        const element = pageAnchorElement(found);
        const target = node.target.at(-1);
        const selector = oneLine(Array.isArray(target) ? target.at(-1) : target, 120);
        return {
            key: `a11y:${result.id}:${found ? elementKey(found) : `${index}:${selector}`}@${path}`,
            summary: oneLine(node.failureSummary?.split('\n').map(line => line.trim()).find(line => line && !fixHeading.test(line)), 200) || help,
            comment: commentText(`Accessibility (${impact}): ${help}.${foundLine('Element', selector || (found && elementLabel(found)))}`, failureLines(node.failureSummary), foot),
            // axe-core's rule ids are lowercase words with hyphens; a custom rule named otherwise has no id to keep
            path,
            check: { type: 'accessibility', id: commentCheckIdPattern.test(result.id) ? result.id : 'custom' },
            element,
            label: found ? elementLabel(found) : selector || undefined
        };
    });
    return { id: result.id, impact, help, helpUrl, standard, issues };
}

let previous: Promise<unknown> = Promise.resolve();

/**
 * Loads axe-core (the lazy audit asset) and checks the page. axe-core runs one audit at a time:
 * a check asked for while one runs waits for it and then checks the page as it is now, so a panel
 * that stays open after a navigation never gets the previous page's report.
 */
export function checkAccessibility(path: string): Promise<AccessibilityReport> {
    const audit = previous.catch(() => undefined).then(async () => {
        const axe = await loadAxe();
        // The review layer is not the page: its host (wherever the page's layers moved it) and inline threads
        const exclude = [getToolbarHost(), ...document.querySelectorAll('[data-uier-thread]')].filter(node => node instanceof Element);
        const results = await axe.run(
            exclude.length ? { exclude } : document,
            // Frames are other documents (and maybe other sites): only this document is checked
            { resultTypes: ['violations'], elementRef: true, iframes: false, performanceTimer: false });
        const rules = results.violations.map(result => ruleOf(result, path))
            .sort((a, b) => impacts.indexOf(a.impact) - impacts.indexOf(b.impact) || b.issues.length - a.issues.length);
        return { path, checkedAt: Date.now(), rules, count: rules.reduce((total, rule) => total + rule.issues.length, 0) };
    });
    previous = audit;
    return audit;
}
