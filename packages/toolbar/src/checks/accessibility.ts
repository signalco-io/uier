import type { ElementContext, ImpactValue, Result, RunOptions } from 'axe-core';
import { getToolbarHost } from '../mount';
import { loadAxe } from './axeLoader';
import type { AxeApi } from './auditHandoff';
import { nextIdle } from './pageIdle';
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
        const axe = await loadAxe();
        signal?.throwIfAborted();
        const exclude = auditExcluded();
        const order = new Map(axe.getRules().map((rule, index) => [rule.ruleId, index]));
        let violations: Result[] | undefined;
        if (background && !background.hurry?.()) violations = await auditInSteps(axe, exclude, signal, background.hurry);
        else {
            signal?.throwIfAborted();
            violations = (await axe.run(exclude.length ? { exclude } : document, runOptions)).violations;
        }
        if (!violations) return undefined;
        const rules = violations.map(result => ruleOf(result, path))
            .sort((a, b) => impacts.indexOf(a.impact) - impacts.indexOf(b.impact) || b.issues.length - a.issues.length
                || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        return { path, checkedAt: Date.now(), rules, count: rules.reduce((total, rule) => total + rule.issues.length, 0) };
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

// Frames are other documents (and maybe other sites): only this document is checked
const runOptions = { resultTypes: ['violations'], elementRef: true, iframes: false, performanceTimer: false } satisfies RunOptions;

/**
 * The background audit's bounds. Its steps scale with the document: over this many elements it is
 * not run unasked (the panel and Check again still check the page). A step aims at `stepTarget` ms
 * (the next one takes fewer rules or elements when one took longer), and one that took over
 * `stepLimit` ms (a slow device) ends it: the panel checks the page when it opens.
 */
export const backgroundElementLimit = 1_500;
const stepTarget = 50;
const stepLimit = 200;
/** The rules whose work grows with every element checked; they have no page-wide step (`after`), so they run on parts of the document */
const perElementRules = ['color-contrast', 'link-in-text-block'];

/**
 * The background audit: the rules axe-core runs by default, in short steps, each its own task when
 * the browser is idle. Groups of rules on the whole document, then the per-element rules on parts of
 * it (disjoint subtrees in document order, and the larger elements' own text). Finds what one run
 * finds; `undefined` when a step took too long.
 */
async function auditInSteps(axe: AxeApi, exclude: Element[], signal: AbortSignal | undefined, hurry?: () => boolean): Promise<Result[] | undefined> {
    const found = new Map<string, Result>();
    const keep = (results: Result[]) => {
        for (const result of results) {
            const kept = found.get(result.id);
            if (kept) kept.nodes.push(...result.nodes);
            else found.set(result.id, result);
        }
    };
    // The context is read when the step runs: the page can change while it waits (axe-core refuses one without elements)
    const step = async (contextOf: () => ElementContext | undefined, rules: string[]) => {
        await nextIdle(signal, { soon: hurry?.() });
        signal?.throwIfAborted();
        const context = contextOf();
        if (!context) return 0;
        const started = performance.now();
        keep((await axe.run(context, { ...runOptions, runOnly: { type: 'rule', values: rules } })).violations);
        const took = performance.now() - started;
        return took > stepLimit && !hurry?.() ? undefined : took;
    };
    // At most twice as many at once: a run's cost is not all in proportion to its size
    const scale = (size: number, took: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(size * Math.min(2, stepTarget / Math.max(took, 1)))));

    const rules = axe.getRules().filter(rule => rule.enabled !== false).map(rule => rule.ruleId);
    const pageRules = rules.filter(rule => !perElementRules.includes(rule));
    const elementRules = rules.filter(rule => perElementRules.includes(rule));
    const whole = exclude.length ? { exclude } : document;
    for (let next = 0, size = 2; next < pageRules.length;) {
        const took = await step(() => whole, pageRules.slice(next, next + size));
        if (took === undefined) return undefined;
        next += size;
        size = scale(size, took, 1, 24);
    }
    if (!elementRules.length) return [...found.values()];

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
    // A larger element is checked on its own only where these rules can find it: its own text, or a link
    for (const element of larger) {
        if (element.localName !== 'a' && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim())) continue;
        const took = await step(() => element.isConnected ? { include: [element], exclude: [...element.children, ...exclude] } : undefined, elementRules);
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
    for (const result of found.values()) {
        if (!elementRules.includes(result.id)) continue;
        result.nodes.sort((a, b) => a.element && b.element
            ? a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
            : 0);
    }
    return [...found.values()];
}
