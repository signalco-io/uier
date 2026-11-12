import type { NodeResult } from 'axe-core';
import type { CommentItem } from '../components/@types/Comments';
import { sectionDefinitions } from '../components/checks/sections';
import type { CommentCheck } from '../feedbackTypes';
import { resolveAnchorElement } from '../hooks/useCommentItemRects';
import { auditExcluded, withAxe } from './accessibility';
import { auditAvailable, loadChecks } from './axeLoader';
import { isRendered, oneLine, pageAnchorElement } from './pageElements';
import { checkSeo } from './seo';
import type { CheckState, PageCheck } from './types';
import { vitalCheck, vitalTargets, type VitalName, type WebVitals } from './webVitals';
import { messages } from '../i18n';

// A comment posted from a page check (`CommentItem.check`) runs that one check again, here and now,
// on the comment's element (packages/toolbar/docs/page-checks-verify.md). Evidence for whoever
// verifies the fix, never a change of the thread's status.

/** What the check found now: still found (`warn`), no longer found (`pass`), or a note (`none`) */
export type Recheck = { state: CheckState; text: string; reason?: string };

/** Where the check runs: the whole page, or the comment's element (`content`: the main content a page finding is pinned to) */
type Target = { element?: Element; content?: boolean; several?: boolean };

/** The SEO panel's own checks (`seo.ts`), which need no audit asset */
const seoIds = ['robots', 'title', 'description', 'canonical', 'h1', 'levels', 'empty-heading', 'link-text', 'link-address', 'alt'];
const vitalNames: Record<string, VitalName> = { lcp: 'LCP', cls: 'CLS', inp: 'INP' };

/** Several elements of one rule in one comment: checked on the whole page (an optional field of newer comments) */
function severalElements(check: CommentCheck) {
    const count = (check as { count?: number }).count;
    return typeof count === 'number' && count >= 2;
}

/**
 * Whether the comment's check can run again here, from what is known before running it: the audit
 * asset for axe-core rules and the panels' sections, a rule id to run, a measured Core Web Vital,
 * and the comment's element on the page
 */
export function canRecheck(comment: CommentItem, vitals?: WebVitals): boolean {
    const { check } = comment;
    if (!check || check.type === 'consent') return false;
    if (check.type === 'web-vitals') {
        const name = vitalNames[check.id];
        return Boolean(name && vitals?.[name].supported);
    }
    if (check.type === 'accessibility' ? check.id === 'custom' || !auditAvailable() : !seoIds.includes(check.id) && !auditAvailable()) return false;
    return comment.position.type === 'page' || severalElements(check) || resolveAnchorElement(comment.position) !== null;
}

// In the toolbar's language, as the check runs again
const stillFound = (reason?: string): Recheck => ({ state: 'warn', text: messages().checks.recheck.stillFound, reason });
const gone = (): Recheck => ({ state: 'pass', text: messages().checks.recheck.gone });
const elementsFound = (n: number, what: 'check' | 'rule'): Recheck => n
    ? { state: 'warn', text: what === 'check' ? messages().checks.recheck.elementsCheck(n) : messages().checks.recheck.elementsRule(n) }
    : gone();
const sentence = (text: string | undefined) => text && /[.!?]$/.test(text) ? text : text && `${text}.`;

/** A check's rows of a report (the SEO panel's, a section's): the check found again, or nothing when this report does not have it */
function judge(rows: readonly PageCheck[], check: CommentCheck, target: Target): Recheck | undefined {
    const sameCheck = (item: { check: CommentCheck }) => item.check.type === check.type && item.check.id === check.id;
    const matched = rows.filter(row => row.id === check.id || row.issues.some(sameCheck));
    if (!matched.length) return undefined;
    const issues = matched.flatMap(row => row.issues.filter(sameCheck));
    if (target.several) return elementsFound(issues.length, 'check');
    const warning = matched.find(row => row.state === 'warn');
    // About the page: whether the check is still worth a look
    if (!target.element) return warning ? stillFound(warning.reason) : gone();
    const found = issues.find(issue => pageAnchorElement(issue.element) === target.element)
        ?? (target.content && warning ? issues.find(issue => !issue.element) : undefined);
    return found ? stillFound(sentence(found.summary)) : gone();
}

/** The first line of axe-core's failure summary ("Element does not have an alt attribute") */
function failureLine(node: NodeResult | undefined) {
    return sentence(oneLine(node?.failureSummary?.split('\n').map(line => line.trim()).find(line => line && !/^Fix (any|all) of the following:?$/i.test(line)), 200) || undefined);
}

/**
 * Rules whose work grows with every element and that judge each element on its own (no page-wide
 * step): checked on the comment's element alone. Every other rule runs on the whole page, since
 * many compare an element with the rest of it (`heading-order`, `landmark-unique`, `duplicate-id-aria`).
 */
const elementRules = ['color-contrast', 'link-in-text-block'];

/** One axe-core rule again; `undefined` when this axe-core has no such rule (a section's check), `null` when it cannot run here */
function recheckRule(id: string, target: Target, signal: AbortSignal): Promise<Recheck | null | undefined> {
    return withAxe(async axe => {
        if (!axe.getRules().some(rule => rule.ruleId === id)) return undefined;
        const { element } = target;
        // axe-core leaves out what is not rendered: a hidden element would look fixed
        if (element && !isRendered(element)) return null;
        const exclude = auditExcluded();
        const context = element && elementRules.includes(id) ? { include: [element], exclude }
            : exclude.length ? { exclude } : document;
        const { violations } = await axe.run(context, {
            runOnly: { type: 'rule', values: [id] }, resultTypes: ['violations'], elementRef: true, iframes: false, performanceTimer: false
        });
        const nodes = violations.flatMap(result => result.nodes);
        if (target.several) return elementsFound(nodes.length, 'rule');
        const found = element
            ? nodes.find(node => {
                const anchor = pageAnchorElement(node.element);
                return anchor === element || (target.content && !anchor);
            })
            : nodes[0];
        return found ? stillFound(failureLine(found)) : gone();
    }, signal);
}

/**
 * The panel's sections that run without being asked (`panel`, `background`; `manual` ones take long
 * or change the page), one at a time, until one reports the check
 */
async function recheckSections(panel: 'accessibility' | 'seo', check: CommentCheck, target: Target, path: string, signal: AbortSignal) {
    if (!auditAvailable()) return undefined;
    const checks = await loadChecks();
    for (const definition of sectionDefinitions) {
        if (definition.panel !== panel || definition.when === 'manual') continue;
        signal.throwIfAborted();
        let report;
        try {
            report = await definition.run(checks, { path, signal });
        } catch (error) {
            signal.throwIfAborted();
            console.warn(`uier-toolbar: The ${definition.id} check could not run`, error);
            continue;
        }
        const found = report && judge(report.checks, check, target);
        if (found) return found;
    }
    return undefined;
}

/** A Core Web Vital, as measured in this visit so far */
function recheckVital(id: string, vitals: WebVitals): Recheck | undefined {
    const name = vitalNames[id];
    const vital = name && vitals[name];
    if (!name || !vital?.supported) return undefined;
    const row = vitalCheck(name, vital);
    if (vital.value === undefined) {
        return row.state === 'pass' ? { state: 'pass', text: messages().checks.recheck.allFast }
            : { state: 'none', text: messages().checks.recheck.notMeasured };
    }
    const target = vitalTargets[name];
    return { state: row.state, text: messages().checks.recheck.vital(target.text(vital.value), row.state === 'warn', target.text(target.good)) };
}

async function run(comment: CommentItem, path: string, signal: AbortSignal, vitals?: WebVitals): Promise<Recheck | undefined> {
    const { check } = comment;
    if (!check || check.type === 'consent') return undefined;
    if (check.type === 'web-vitals') return vitals && recheckVital(check.id, vitals);
    let target: Target = {};
    if (severalElements(check)) target = { several: true };
    else if (comment.position.type !== 'page') {
        const element = resolveAnchorElement(comment.position);
        // Its element is not on the page (now): nothing to check it on
        if (!element) return undefined;
        target = { element, content: element === (document.querySelector('main') ?? document.body) };
    }
    if (check.type === 'accessibility') {
        if (check.id === 'custom' || !auditAvailable()) return undefined;
        const rule = await recheckRule(check.id, target, signal);
        if (rule !== undefined) return rule ?? undefined;
        return recheckSections('accessibility', check, target, path, signal);
    }
    const seo = checkSeo(path);
    return judge([...seo.page, ...seo.headings.checks, ...seo.links.checks, ...seo.images.checks], check, target)
        ?? recheckSections('seo', check, target, path, signal);
}

let previous: Promise<unknown> = Promise.resolve();

/**
 * Runs the comment's check again on this page (`path`), one re-check at a time across threads:
 * `undefined` when it cannot be checked here (an unknown check, its element gone or hidden). A
 * cancelled one (`signal`: the thread closed, the page changed) never starts, and one running stops
 * at its next step (axe-core's queue, a section).
 */
export function recheck(comment: CommentItem, path: string, signal: AbortSignal, vitals?: WebVitals): Promise<Recheck | undefined> {
    const next = previous.catch(() => undefined).then(() => {
        signal.throwIfAborted();
        return run(comment, path, signal, vitals);
    });
    previous = next;
    return next;
}
