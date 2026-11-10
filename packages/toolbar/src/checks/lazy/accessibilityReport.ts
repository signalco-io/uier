import type { ElementContext, IncompleteResult, NodeResult, Result, RunOptions } from 'axe-core';
import type { AxeApi } from '../auditHandoff';
import type { AccessibilityReport, AccessibilityRule } from '../accessibility';
import { impacts, ruleStandard, type Impact } from '../axeRules';
import { commentCheckIdPattern } from '../../feedbackTypes';
import { nextIdle } from '../pageIdle';
import { elementKey, elementLabel, foundLine, oneLine, pageAnchorElement } from '../pageElements';
import type { PageIssue } from '../types';
import { words } from './locale';

// The Accessibility panel's audit, in the audit asset beside axe-core (the review bundle has the
// queue, `checkAccessibility` in ../accessibility.ts): every rule axe-core runs by default (WCAG A
// and AA, and best practices) and WCAG 2.2's target size, as the panel's report. What axe-core could
// not decide is kept apart, for a person to judge.

/** The API's text limit (`commentTextMaxLength`) */
const commentLimit = 1000;

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

const fixHeading = /^Fix (any|all) of the following:?$/i;
/** The heading of what axe-core could not decide on an element, in the toolbar's language */
const reviewHeading = () => words().accessibility.undecided;

/** axe-core's failure summary of one element as Markdown lines: its "Fix any of the following:" headings, each failure a list item */
function failureLines(summary: string | undefined) {
    return (summary ?? '').split('\n').map(line => line.trim()).filter(Boolean)
        .map(line => fixHeading.test(line) ? line : `- ${oneLine(line, 300)}`);
}

/**
 * The comment of one element's issue: the rule, the element, what axe-core measured on it (the
 * contrast ratio, the missing attribute) or why it could not decide, then the standard and the
 * rule's page. Lines that would pass the API's text limit are left out; the rule's page has them all.
 */
function commentText(head: string, failures: string[], foot: string) {
    const kept: string[] = [];
    // The blank line before the foot ends the list
    let length = head.length + foot.length + 2;
    for (const line of failures) {
        if (length + line.length + 1 > commentLimit) break;
        kept.push(line);
        length += line.length + 1;
    }
    // A heading whose lines were all left out says nothing
    while (kept.length && (fixHeading.test(kept.at(-1)!) || kept.at(-1) === reviewHeading())) kept.pop();
    return kept.length ? `${head}\n${kept.join('\n')}\n\n${foot}` : `${head}\n${foot}`;
}

/** Why axe-core could not decide on an element: the messages of its undecided checks, each once */
function reviewReasons(node: NodeResult) {
    return [...new Set([...node.any, ...node.all, ...node.none].map(check => oneLine(check.message, 300)).filter(Boolean))];
}

/**
 * Issue keys end with the page's path, so a comment posted on one page doesn't mark the same finding
 * on another. `review`: an incomplete result, what axe-core could not decide (its own keys, and its
 * reasons instead of failures: a person has to judge it).
 */
function ruleOf(result: Result, path: string, review = false): AccessibilityRule {
    const impact = impacts.includes(result.impact as Impact) ? result.impact as Impact : 'minor';
    const help = oneLine(result.help, 200).replace(/\.$/, '');
    const helpUrl = ruleLink(result.helpUrl);
    const standard = ruleStandard(result.tags);
    // The rule's help and failures are axe-core's own words (English); the toolbar's are around them
    const { accessibility: t, found: names } = words();
    const foot = t.foot(standard === 'Best practice' ? t.bestPractice : standard ?? '', result.id, helpUrl);
    const head = t.head(review ? t.toReview : t.impacts[impact], help);
    const issues = result.nodes.map((node, index): PageIssue => {
        const found = node.element ?? undefined;
        const target = node.target.at(-1);
        const selector = oneLine(Array.isArray(target) ? target.at(-1) : target, 120);
        const reasons = review ? reviewReasons(node) : [];
        const elementLine = foundLine(names.element, selector || (found && elementLabel(found)));
        return {
            key: `a11y${review ? '-review' : ''}:${result.id}:${found ? elementKey(found) : `${index}:${selector}`}@${path}`,
            summary: oneLine(review ? reasons[0] : node.failureSummary?.split('\n').map(line => line.trim()).find(line => line && !fixHeading.test(line)), 200) || help,
            comment: review
                ? commentText(`${head}${elementLine}`, [reviewHeading(), ...reasons.map(reason => `- ${reason}`)], t.personCheck(foot))
                : commentText(`${head}${elementLine}`, failureLines(node.failureSummary), foot),
            path,
            // axe-core's rule ids are lowercase words with hyphens; a custom rule named otherwise has no id to keep
            check: { type: 'accessibility', id: commentCheckIdPattern.test(result.id) ? result.id : 'custom' },
            element: pageAnchorElement(found),
            label: found ? elementLabel(found) : selector || undefined,
            selector: selector || undefined,
            ...review ? { review } : {}
        };
    });
    return {
        id: result.id, impact, help, helpUrl, standard, issues, ...review ? { review } : {},
        group: { head, foot: review ? t.personCheckAll(foot) : foot }
    };
}

/** Rules by impact, then by how many elements, then in axe-core's order, so Check again lists the same report */
function sortedRules(results: Result[], path: string, order: Map<string, number>, review = false) {
    return results.filter(result => result.nodes.length).map(result => ruleOf(result, path, review))
        .sort((a, b) => impacts.indexOf(a.impact) - impacts.indexOf(b.impact) || b.issues.length - a.issues.length
            || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** What an audit found: the issues, and what axe-core could not decide (for a person to judge) */
type Found = { violations: Result[]; incomplete: Result[] };

/** Rules axe-core has but does not run by default, which the audit runs too: WCAG 2.2's target size (2.5.8, AA) */
const addedRules = ['target-size'];

// Frames are other documents (and maybe other sites): only this document is checked. Incomplete
// results keep all their elements (axe-core keeps one of each rule for a type it is not asked for).
const runOptions = {
    resultTypes: ['violations', 'incomplete'], elementRef: true, iframes: false, performanceTimer: false,
    rules: Object.fromEntries(addedRules.map(rule => [rule, { enabled: true }]))
} satisfies RunOptions;

/**
 * The page's audit as the panel's report: one `axe.run` of the whole page, or (`steps`, the audit
 * nobody asked for yet) in short steps when the browser is idle, `undefined` when a step took too
 * long. `exclude`: the review layer, never the page.
 */
export async function auditPage(axe: AxeApi, path: string, exclude: Element[], { signal, steps, hurry }: {
    signal?: AbortSignal;
    steps?: boolean;
    /** The panel waits for the steps now: no idle waits, no limits */
    hurry?: () => boolean;
}): Promise<AccessibilityReport | undefined> {
    const order = new Map(axe.getRules().map((rule, index) => [rule.ruleId, index]));
    let found: Found | undefined;
    if (steps) found = await auditInSteps(axe, exclude, signal, hurry);
    else {
        signal?.throwIfAborted();
        found = await axe.run(exclude.length ? { exclude } : document, runOptions);
    }
    if (!found) return undefined;
    const rules = sortedRules(found.violations, path, order);
    // A rule that could not run (its error) is not something a person can judge on the page
    const review = sortedRules(found.incomplete.filter(result => !(result as IncompleteResult).error), path, order, true);
    return { path, checkedAt: Date.now(), rules, count: rules.reduce((total, rule) => total + rule.issues.length, 0), review };
}

/**
 * The background audit's steps: each aims at `stepTarget` ms (the next one takes fewer rules or
 * elements when one took longer), and one that took over `stepLimit` ms (a slow device) ends it: the
 * panel checks the page when it opens.
 */
const stepTarget = 50;
const stepLimit = 200;
/**
 * The rules whose work grows with every element checked; they have no page-wide step (`after`), so
 * they run on parts of the document. An element's result is the same as in one run of the whole
 * page: they measure it in the whole page's layout (axe-core's grid of every element, also outside
 * the part), which target size uses for a target's neighbours.
 */
const perElementRules = ['color-contrast', 'link-in-text-block', 'target-size'];
/** Of those, the ones that check controls (a larger element that takes the focus, such as a `select` with its options) */
const controlRules = ['target-size'];
/** Elements that may take the focus: what target size checks (axe-core decides; this must only not miss one) */
const focusable = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls]';

/**
 * The background audit: the rules axe-core runs by default and the added ones, in short steps, each
 * its own task when the browser is idle. Groups of rules on the whole document, then the per-element
 * rules on parts of it (disjoint subtrees in document order, and the larger elements' own text or,
 * for a control, the element itself). Finds what one run finds, the undecided too; `undefined` when
 * a step took too long.
 */
async function auditInSteps(axe: AxeApi, exclude: Element[], signal: AbortSignal | undefined, hurry?: () => boolean): Promise<Found | undefined> {
    const violations = new Map<string, Result>();
    const incomplete = new Map<string, Result>();
    const merge = (into: Map<string, Result>, results: Result[]) => {
        for (const result of results) {
            const kept = into.get(result.id);
            if (kept) kept.nodes.push(...result.nodes);
            else into.set(result.id, result);
        }
    };
    const found = () => ({ violations: [...violations.values()], incomplete: [...incomplete.values()] });
    // The context is read when the step runs: the page can change while it waits (axe-core refuses one without elements)
    const step = async (contextOf: () => ElementContext | undefined, rules: string[]) => {
        await nextIdle(signal, { soon: hurry?.() });
        signal?.throwIfAborted();
        const context = contextOf();
        if (!context) return 0;
        const started = performance.now();
        const results = await axe.run(context, { ...runOptions, runOnly: { type: 'rule', values: rules } });
        merge(violations, results.violations);
        merge(incomplete, results.incomplete);
        const took = performance.now() - started;
        return took > stepLimit && !hurry?.() ? undefined : took;
    };
    // At most twice as many at once: a run's cost is not all in proportion to its size
    const scale = (size: number, took: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(size * Math.min(2, stepTarget / Math.max(took, 1)))));

    const rules = axe.getRules().filter(rule => rule.enabled !== false || addedRules.includes(rule.ruleId)).map(rule => rule.ruleId);
    const pageRules = rules.filter(rule => !perElementRules.includes(rule));
    const elementRules = rules.filter(rule => perElementRules.includes(rule));
    const whole = exclude.length ? { exclude } : document;
    for (let next = 0, size = 2; next < pageRules.length;) {
        const took = await step(() => whole, pageRules.slice(next, next + size));
        if (took === undefined) return undefined;
        next += size;
        size = scale(size, took, 1, 24);
    }
    if (!elementRules.length) return found();

    // Disjoint subtrees of at most `limit` elements, and the larger elements above them
    const excluded = (element: Element) => exclude.some(node => node.contains(element));
    const sizes = new Map<Element, number>();
    const measure = (element: Element): number => {
        let size = 1;
        for (const child of element.children) size += measure(child);
        sizes.set(element, size);
        return size;
    };
    measure(document.documentElement);
    const parts: Element[] = [];
    const larger: Element[] = [];
    let limit = 50;
    const split = (element: Element) => {
        if (excluded(element)) return;
        if (sizes.get(element)! <= limit) {
            parts.push(element);
            return;
        }
        larger.push(element);
        for (const child of element.children) split(child);
    };
    split(document.documentElement);
    // A larger element is checked on its own only where these rules can find it: its own text or a
    // link (every rule), else a control (the rules for controls)
    for (const element of larger) {
        const text = element.localName === 'a' || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim());
        const rules = text ? elementRules : element.matches(focusable) ? elementRules.filter(rule => controlRules.includes(rule)) : [];
        if (!rules.length) continue;
        const took = await step(() => element.isConnected ? { include: [element], exclude: [...element.children, ...exclude] } : undefined, rules);
        if (took === undefined) return undefined;
    }
    for (let next = 0; next < parts.length;) {
        const include: Element[] = [];
        for (let size = 0; next < parts.length && (!include.length || size + sizes.get(parts[next]!)! <= limit); next++) {
            include.push(parts[next]!);
            size += sizes.get(parts[next]!)!;
        }
        const took = await step(() => {
            const connected = include.filter(element => element.isConnected);
            if (!connected.length) return undefined;
            return exclude.length ? { include: connected, exclude } : { include: connected };
        }, elementRules);
        if (took === undefined) return undefined;
        // Each run also has a cost of its own (axe-core reads the whole page): no smaller than 50 elements
        limit = scale(limit, took, 50, 1_000);
    }
    // In document order, like one run lists them
    for (const result of [...violations.values(), ...incomplete.values()]) {
        if (!elementRules.includes(result.id)) continue;
        result.nodes.sort((a, b) => a.element && b.element
            ? a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
            : 0);
    }
    return found();
}
