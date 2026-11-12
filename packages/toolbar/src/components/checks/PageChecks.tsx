import { useToolbarFeatures } from '../../hooks/useToolbarFeatures';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { backgroundElementLimit, checkAccessibility } from '../../checks/accessibility';
import { checkSeo, type SeoReport } from '../../checks/seo';
import { startWebVitals, useWebVitals } from '../../checks/webVitals';
import { pageSettled } from '../../checks/pageSettled';
import { pageIdle, savesData } from '../../checks/pageIdle';
import { auditAvailable } from '../../checks/axeLoader';
import { RestoredPanelContext } from '../../openPanel';
import { isRendered, pageAnchorElement } from '../../checks/pageElements';
import { reportedComment } from '../../checks/reportedIssue';
import { dismissedIdentity, dismissedPrefix, readDismissed, writeDismissed } from '../../checks/dismissedIssues';
import { groupIssue } from '../../checks/issueGroup';
import type { IssueGroup, PageCheck, PageIssue } from '../../checks/types';
import { usePagePath } from '../../hooks/usePagePath';
import { useComments } from '../../hooks/useComments';
import { useAnnounce } from '../Announcer';
import type { CommentItem } from '../@types/Comments';
import { AccessibilityPanel, type AccessibilityState } from './AccessibilityPanel';
import { SecurityPanel } from './SecurityPanel';
import { SeoPanel, seoChecks, tally, vitalChecks } from './SeoPanel';
import { ChecksContext, type PostedComment } from './ChecksParts';
import { ElementHighlight } from './ElementHighlight';
import { PageSummaryReporter } from './PageSummaryReporter';
import { sectionDefinitions } from './sections';
import { PageLayerContext, SectionsContext, sectionsAttention, useSectionsStore } from './sections/sections';
import { GuestNameProvider, useGuestNameGate } from './GuestName';
import { useIssueComment } from './useIssueComment';
import { messages } from '../../i18n';

export type ChecksPanelId = 'accessibility' | 'seo' | 'consent';
export type ShownComment = Extract<PostedComment, { status: 'posted' }>;
/** What each panel's report of this page found to act on (accessibility issues, SEO checks to look at); none before a report */
export type ChecksAttention = Partial<Record<ChecksPanelId, number>>;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The Accessibility and SEO panels, open (`panels`) alone or together, each docked on its own side, and what they keep while closed:
 * the last reports, the comments their quick actions posted and the highlighted element. Both check
 * the page in the background once it has loaded and the browser is idle (while the toolbar is
 * expanded), so a panel opens with its report; a panel opened before that checks the page then, and
 * Check again checks it again. A panel that stays open from the previous page checks this page once
 * it has rendered.
 */
export function PageChecks(props: {
    /** The open checks panels */
    panels: readonly ChecksPanelId[];
    /** The toolbar is collapsed: nothing is outlined on the page */
    collapsed: boolean;
    onClose: (panel: ChecksPanelId) => void;
    /** "Show" in `panel`: the posted comment's thread (or the inbox, for one about the page) */
    onShowComment: (comment: ShownComment, panel: ChecksPanelId) => void;
    /** What the reports of this page found to act on, for the pill's indicators */
    onAttentionChange?: (attention: ChecksAttention) => void;
}) {
    const features = useToolbarFeatures();
    if (!features.includes('accessibility') && !features.includes('seo') && !features.includes('consent')) return null;
    return <GuestNameProvider><PageChecksPanels {...props} panels={props.panels.filter(panel => features.includes(panel))} /></GuestNameProvider>;
}

function PageChecksPanels({ panels, collapsed, onClose, onShowComment, onAttentionChange }: Parameters<typeof PageChecks>[0]) {
    // Measured from the review layer's start, so interactions before a panel opens count too; stopped when it leaves
    const features = useToolbarFeatures();
    const accessibilityAvailable = features.includes('accessibility') && auditAvailable();
    const seoAvailable = features.includes('seo');
    useEffect(() => { if (seoAvailable) return startWebVitals(); }, [seoAvailable]);
    const path = usePagePath();
    const pathRef = useRef(path);
    pathRef.current = path;
    const panelsRef = useRef(panels);
    panelsRef.current = panels;
    const accessibilityOpen = panels.includes('accessibility');
    const seoOpen = panels.includes('seo');
    const consentOpen = panels.includes('consent');
    const announce = useAnnounce();
    const [accessibility, setAccessibility] = useState<AccessibilityState>({ checking: false });
    const [seo, setSeo] = useState<SeoReport>();
    // The sections whose checks run on demand, in the audit asset: their reports, kept like the two above
    const enabledSections = useMemo(() => sectionDefinitions.filter(definition => definition.panel === 'accessibility' ? accessibilityAvailable : features.includes(definition.panel)), [features, accessibilityAvailable]);
    const sections = useSectionsStore(path, enabledSections);
    const [posted, setPosted] = useState<ReadonlyMap<string, PostedComment>>(() => new Map());
    // The element outlined from a panel's issue, while that panel is open
    const [highlighted, setHighlighted] = useState<{ key: string; element: Element; panel: ChecksPanelId }>();
    // Open on the previous page: this page can still be rendering, so its check waits for it to settle
    const restored = useContext(RestoredPanelContext);
    const [settling, setSettling] = useState(() => panels.some(panel => restored.includes(panel)));
    // The panels waiting for it (two restored panels wait together)
    const settle = useRef<{ wait: ReturnType<typeof pageSettled>; panels: Set<ChecksPanelId> }>(undefined);
    useEffect(() => () => {
        settle.current?.wait.cancel();
        settle.current = undefined;
    }, []);
    const postIssue = useIssueComment();
    const pageComments = useComments().query.data;
    // Findings marked "Not an issue" in this browser: they leave every count, folded under their list
    const [dismissed, setDismissed] = useState(readDismissed);
    const dismissedPrefixes = useMemo(() => new Set([...dismissed.keys()].map(identity => identity.split('.')[0])), [dismissed]);
    const isDismissed = (issue: PageIssue) => dismissedPrefixes.has(dismissedPrefix(issue)!) && dismissed.has(dismissedIdentity(issue)!);
    // What this panel posted keeps its own words ("Bug report sent"); a finding reported before, by
    // anyone, is found among the page's open threads, so it is still marked after a reload
    // Each comment's element, looked up once per render for all the issues
    const commentAnchors = new Map<CommentItem, Element | null>();
    // A rule's elements, issues and the undecided apart: one comment for several of one list is not the other's
    let ruleElements: Map<string, Set<Element | undefined>> | undefined;
    const otherList = (issue: PageIssue) => {
        ruleElements ??= new Map([...accessibility.report?.rules ?? [], ...accessibility.report?.review ?? []]
            .map(rule => [`${rule.review ? 'review' : ''}:${rule.id}`, new Set(rule.issues.map(item => pageAnchorElement(item.element)))]));
        return ruleElements.get(`${issue.review ? '' : 'review'}:${issue.check.id}`);
    };
    const reportOf = (issue: PageIssue): PostedComment | undefined => {
        const own = posted.get(issue.key);
        if (own) return own;
        const reported = reportedComment(issue, pageComments, path, commentAnchors,
            issue.check.type === 'accessibility' ? anchor => !anchor || !otherList(issue)?.has(anchor) : undefined);
        return reported && { status: 'posted', commentId: reported.id, page: reported.position.type === 'page', number: reported.number, label: messages().checks.reported };
    };
    const nameGate = useGuestNameGate();

    /** Out of `issues`, into `dismissed`: the issues marked "Not an issue" (none marked: the same object) */
    const withoutDismissed = <T extends { issues: PageIssue[]; dismissed?: PageIssue[] }>(item: T): T => {
        const hidden = dismissed.size ? item.issues.filter(isDismissed) : [];
        return hidden.length ? { ...item, issues: item.issues.filter(issue => !hidden.includes(issue)), dismissed: hidden } : item;
    };
    /** A check worth a look whose every issue is marked "Not an issue" is a note: a deliberate choice */
    const checkWithoutDismissed = (check: PageCheck): PageCheck => {
        const next = withoutDismissed(check);
        return next !== check && !next.issues.length && check.state === 'warn' ? { ...next, state: 'none' } : next;
    };
    const shownAccessibility = useMemo((): AccessibilityState => {
        const { report } = accessibility;
        if (!report || !dismissed.size) return accessibility;
        const rules = report.rules.map(withoutDismissed);
        return { ...accessibility, report: { ...report, rules, review: report.review?.map(withoutDismissed),
            count: rules.reduce((total, rule) => total + rule.issues.length, 0) } };
    }, [accessibility, dismissed]);
    const shownSeo = useMemo(() => seo && dismissed.size ? {
        ...seo,
        page: seo.page.map(checkWithoutDismissed),
        headings: { ...seo.headings, checks: seo.headings.checks.map(checkWithoutDismissed) },
        links: { ...seo.links, checks: seo.links.checks.map(checkWithoutDismissed) },
        images: { ...seo.images, checks: seo.images.checks.map(checkWithoutDismissed) }
    } : seo, [seo, dismissed]);
    // The sections' reports the same way, so their views and the panels' counts leave them out
    const shownSections = dismissed.size ? {
        ...sections,
        states: new Map([...sections.states].map(([id, state]): [string, typeof state] => [id, state.report
            ? { ...state, report: { ...state.report, checks: state.report.checks.map(checkWithoutDismissed) } } : state]))
    } : sections;

    // Only the latest audit's result is shown (a page reached since, or Check again, asked for a newer one)
    const latestAudit = useRef(0);
    // The latest audit's cancellation: a newer audit, collapsing (for one in the background) and leaving the page cancel it
    const auditControl = useRef<{ controller: AbortController; background: boolean }>(undefined);
    useEffect(() => () => auditControl.current?.controller.abort(), []);
    // The page the running or last audit checks (none after one failed or was cancelled), read before React renders its state
    const auditedPath = useRef<string>(undefined);
    const seoPath = useRef<string>(undefined);
    const runAccessibility = ({ background = false } = {}) => {
        const audit = ++latestAudit.current;
        auditControl.current?.controller.abort();
        const controller = new AbortController();
        auditControl.current = { controller, background };
        auditedPath.current = pathRef.current;
        setAccessibility(current => ({ ...current, checking: true, error: false }));
        if (!background) setHighlighted(undefined);
        const ended = () => {
            if (auditControl.current?.controller === controller) auditControl.current = undefined;
        };
        // An open panel waits for the background audit: it goes on without waiting for idle moments
        const report = background
            ? checkAccessibility(pathRef.current, { signal: controller.signal, background: { hurry: () => panelsRef.current.includes('accessibility') } })
            : checkAccessibility(pathRef.current, { signal: controller.signal });
        report.then(report => {
            ended();
            if (audit !== latestAudit.current) return;
            if (report) {
                setAccessibility({ report, checking: false });
                return;
            }
            // Too large a page or too slow a device to check unasked: the panel checks it when it opens (or now, if open)
            auditedPath.current = undefined;
            setAccessibility(current => ({ ...current, checking: false }));
            if (panelsRef.current.includes('accessibility')) runAccessibility();
        }, error => {
            ended();
            if (audit !== latestAudit.current) return;
            auditedPath.current = undefined;
            if (controller.signal.aborted) {
                // Cancelled without a newer audit (the toolbar collapsed): checked again when it expands
                setAccessibility(current => ({ ...current, checking: false }));
                return;
            }
            console.warn('uier-toolbar: The accessibility check could not run', error);
            // In the background it fails quietly (the panel checks again when it opens), unless the panel is open meanwhile
            setAccessibility(current => ({ ...current, checking: false, error: !background || panelsRef.current.includes('accessibility') }));
        });
    };
    const runSeo = ({ background = false } = {}) => {
        if (!background) setHighlighted(undefined);
        seoPath.current = pathRef.current;
        setSeo(checkSeo(pathRef.current));
    };

    // In the background, once per page: after it has loaded and rendered, when the browser is idle,
    // and only while the toolbar is expanded (its buttons show what was found). axe-core is still
    // the lazy audit asset; it is not downloaded unasked where the browser saves data. Collapsing
    // cancels a background audit not yet done (queued, loading or between its steps) that no open
    // panel waits for.
    useEffect(() => {
        if (collapsed) return;
        const ready = pageIdle();
        ready.promise.then(() => {
            if (seoAvailable && seoPath.current !== pathRef.current) runSeo({ background: true });
            if (accessibilityAvailable && !savesData() && auditedPath.current !== pathRef.current) runAccessibility({ background: true });
            // The background sections need the audit asset too: where the audit is not run unasked (above, and a page too large for it), neither are they
            if ((accessibilityAvailable || seoAvailable) && auditAvailable() && !savesData() && document.getElementsByTagName('*').length <= backgroundElementLimit) sections.runBackground();
        });
        return () => {
            ready.cancel();
            sections.cancelBackground();
            // An open Accessibility panel (it stays open while collapsed) still waits for it
            if (auditControl.current?.background && !panelsRef.current.includes('accessibility')) auditControl.current.controller.abort();
        };
    }, [collapsed]);

    // Opening a panel checks the page unless it has (or is checking) this page's report
    const check = (panel: ChecksPanelId) => {
        if (panel === 'accessibility' && auditedPath.current !== pathRef.current) runAccessibility();
        if (panel === 'seo' && seoPath.current !== pathRef.current) runSeo();
        sections.runPanel(panel);
    };
    const opened = (panel: ChecksPanelId, open: boolean) => {
        if (!open) {
            settle.current?.panels.delete(panel);
            setHighlighted(current => current?.panel === panel ? undefined : current);
            if (!panelsRef.current.length) stopSettling();
            return;
        }
        if (!settling) {
            check(panel);
            return;
        }
        if (!settle.current) {
            const wait = pageSettled();
            const waiting = settle.current = { wait, panels: new Set<ChecksPanelId>() };
            wait.promise.then(() => {
                if (settle.current !== waiting) return;
                settle.current = undefined;
                setSettling(false);
                waiting.panels.forEach(check);
            });
        }
        settle.current.panels.add(panel);
    };
    useEffect(() => opened('accessibility', accessibilityOpen), [accessibilityOpen]);
    useEffect(() => opened('seo', seoOpen), [seoOpen]);
    useEffect(() => opened('consent', consentOpen), [consentOpen]);
    /** Stops waiting for the page to settle: the panels waiting check it now, except `except` (it checks it itself) */
    function stopSettling(except?: ChecksPanelId) {
        const waiting = settle.current;
        settle.current = undefined;
        waiting?.wait.cancel();
        setSettling(false);
        waiting?.panels.forEach(panel => { if (panel !== except && panelsRef.current.includes(panel)) check(panel); });
    }
    // Check again before the page settled checks it now, once (and another panel waiting with it)
    const checkNow = (panel: ChecksPanelId, run: () => void) => () => {
        stopSettling(panel);
        run();
    };

    const actions = (panel: ChecksPanelId) => ({
        reportOf,
        highlighted: highlighted?.panel === panel ? highlighted.key : undefined,
        highlight: (issue: PageIssue) => {
            if (highlighted?.key === issue.key) {
                setHighlighted(undefined);
                return;
            }
            const element = pageAnchorElement(issue.element) ?? undefined;
            const target = issue.element?.isConnected && isRendered(issue.element) ? issue.element : element;
            if (!target || !isRendered(target)) {
                announce(messages().checks.notVisible);
                return;
            }
            target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            setHighlighted({ key: issue.key, element: target, panel });
        },
        comment: (issue: PageIssue) => {
            if (reportOf(issue) || !nameGate(panel)) return;
            post([issue], issue);
        },
        // One request for all of them (the API limits how fast and how many comments a page gets): each is marked by it
        commentAll: (issues: PageIssue[], group: IssueGroup, of: number) => {
            const open = issues.filter(issue => !reportOf(issue));
            if (open.length < 2 || !nameGate(panel)) return;
            post(open, groupIssue(open, group, of));
        },
        show: (comment: ShownComment) => {
            setHighlighted(undefined);
            onShowComment(comment, panel);
        },
        isDismissed,
        dismiss: (issue: PageIssue) => {
            const identity = dismissedIdentity(issue);
            if (!identity) return;
            if (highlighted?.key === issue.key) setHighlighted(undefined);
            setDismissed(writeDismissed(identity, Date.now()));
            announce(messages().checks.dismissedDone);
        },
        restore: (issue: PageIssue) => {
            const identity = dismissedIdentity(issue);
            if (!identity) return;
            setDismissed(writeDismissed(identity, undefined));
            announce(messages().checks.restored);
        }
    });
    /** Posts `issue` (one of `issues`, or one comment for all of them), marking each of them */
    function post(issues: PageIssue[], issue: PageIssue) {
        const mark = (state?: PostedComment) => setPosted(current => {
            const next = new Map(current);
            for (const { key } of issues) {
                if (state) next.set(key, state); else next.delete(key);
            }
            return next;
        });
        mark({ status: 'sending' });
        postIssue(issue).then(({ comment, page, label }) => {
            mark({ status: 'posted', commentId: comment.id, page, number: comment.number, label });
            announce(issues.length > 1 ? messages().checks.postedForMany(label, issues.length) : label);
        }, () => mark(undefined)); // The toast says it was not posted
    }

    return (
        <SectionsContext value={shownSections}>
        <PageLayerContext value={!collapsed}>
            {accessibilityOpen && (
                <ChecksContext value={actions('accessibility')}>
                    <AccessibilityPanel state={settling ? { ...shownAccessibility, checking: true } : shownAccessibility} path={path} onClose={() => onClose('accessibility')}
                        onCheck={checkNow('accessibility', () => {
                            runAccessibility();
                            sections.runPanel('accessibility', { again: true });
                        })} />
                </ChecksContext>
            )}
            {seoOpen && (
                <ChecksContext value={actions('seo')}>
                    <SeoPanel report={shownSeo} path={path} onClose={() => onClose('seo')}
                        onCheck={checkNow('seo', () => {
                            runSeo();
                            sections.runPanel('seo', { again: true });
                        })} />
                </ChecksContext>
            )}
            {consentOpen && (
                <ChecksContext value={actions('consent')}>
                    <SecurityPanel onClose={() => onClose('consent')} onCheck={checkNow('consent', () => {
                        setHighlighted(undefined);
                        sections.runPanel('consent', { again: true });
                    })} />
                </ChecksContext>
            )}
            {/* What was marked "Not an issue" in this browser is not counted */}
            {onAttentionChange && (
                <ChecksAttentionReporter
                    accessibility={shownAccessibility.report?.path === path ? shownAccessibility.report.count : undefined}
                    accessibilitySections={sectionsAttention(shownSections, 'accessibility')}
                    seo={shownSeo?.path === path ? shownSeo : undefined}
                    seoSections={sectionsAttention(shownSections, 'seo')}
                    consentSections={sectionsAttention(shownSections, 'consent')}
                    onChange={onAttentionChange} />
            )}
            <PageSummaryReporter path={path}
                accessibility={accessibility.report?.path === path ? accessibility.report : undefined}
                seo={seo?.path === path ? seo : undefined} />
            {!collapsed && highlighted && panels.includes(highlighted.panel) && <ElementHighlight element={highlighted.element} />}
        </PageLayerContext>
        </SectionsContext>
    );
}

/**
 * Tells the pill what this page's reports found to act on: the audit's issues, and the SEO checks
 * worth a look (Core Web Vitals included, as in the panel's summary, so it follows them as the page
 * is used), each with what its panel's on-demand sections found. Its own component, so Core Web
 * Vitals' updates re-render only it.
 */
function ChecksAttentionReporter({ accessibility, accessibilitySections, seo, seoSections, consentSections, onChange }: {
    accessibility?: number;
    accessibilitySections: number;
    seo?: SeoReport;
    seoSections: number;
    consentSections: number;
    onChange: (attention: ChecksAttention) => void;
}) {
    const vitals = vitalChecks(useWebVitals());
    const seoCount = seo ? tally(seoChecks(seo, vitals), 'warn') + seoSections : seoSections || undefined;
    // Without the audit's report, only what the sections found (none: no dot and no count)
    const accessibilityCount = accessibility === undefined ? accessibilitySections || undefined : accessibility + accessibilitySections;
    useEffect(() => onChange({ accessibility: accessibilityCount, seo: seoCount, consent: consentSections || undefined }), [accessibilityCount, seoCount, consentSections]);
    return null;
}
