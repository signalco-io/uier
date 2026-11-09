import type { ImpactValue, Result } from 'axe-core';
import { getToolbarHost } from '../mount';
import { loadAxe } from './axeLoader';
import { elementKey, elementLabel, oneLine, pageAnchorElement } from './pageElements';
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

function ruleOf(result: Result): AccessibilityRule {
    const impact = impacts.includes(result.impact as Impact) ? result.impact as Impact : 'minor';
    const help = oneLine(result.help, 200).replace(/\.$/, '');
    const helpUrl = ruleLink(result.helpUrl);
    const issues = result.nodes.map((node, index): PageIssue => {
        const found = node.element ?? undefined;
        const element = pageAnchorElement(found);
        const target = node.target.at(-1);
        const selector = oneLine(Array.isArray(target) ? target.at(-1) : target, 120);
        return {
            key: `a11y:${result.id}:${found ? elementKey(found) : `${index}:${selector}`}`,
            summary: oneLine(node.failureSummary?.split('\n').map(line => line.trim()).find(line => line && !/^Fix (any|all) of the following:?$/i.test(line)), 200) || help,
            comment: [`Accessibility (${impact}): ${help}.`, `Rule ${result.id}${helpUrl ? `: ${helpUrl}` : '.'}`].join('\n'),
            element,
            label: found ? elementLabel(found) : selector || undefined
        };
    });
    return { id: result.id, impact, help, helpUrl, issues };
}

let running: Promise<AccessibilityReport> | undefined;

/**
 * Loads axe-core (the lazy audit asset) and checks the page. axe-core runs one audit at a time:
 * a check asked for while one runs gets that one's result.
 */
export function checkAccessibility(path: string): Promise<AccessibilityReport> {
    running ??= (async () => {
        try {
            const axe = await loadAxe();
            // The review layer is not the page: its host (wherever the page's layers moved it) and inline threads
            const exclude = [getToolbarHost(), ...document.querySelectorAll('[data-uier-thread]')].filter(node => node instanceof Element);
            const results = await axe.run(
                exclude.length ? { exclude } : document,
                // Frames are other documents (and maybe other sites): only this document is checked
                { resultTypes: ['violations'], elementRef: true, iframes: false, performanceTimer: false });
            const rules = results.violations.map(ruleOf)
                .sort((a, b) => impacts.indexOf(a.impact) - impacts.indexOf(b.impact) || b.issues.length - a.issues.length);
            return { path, checkedAt: Date.now(), rules, count: rules.reduce((total, rule) => total + rule.issues.length, 0) };
        } finally {
            running = undefined;
        }
    })();
    return running;
}
