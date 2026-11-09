import { useContext, useEffect, useRef, useState } from 'react';
import { checkAccessibility } from '../../checks/accessibility';
import { checkSeo, type SeoReport } from '../../checks/seo';
import { startWebVitals, useWebVitals } from '../../checks/webVitals';
import { pageSettled } from '../../checks/pageSettled';
import { pageIdle, savesData } from '../../checks/pageIdle';
import { auditAvailable } from '../../checks/axeLoader';
import { RestoredPanelContext } from '../../openPanel';
import { isRendered, pageAnchorElement } from '../../checks/pageElements';
import { reportedComment } from '../../checks/reportedIssue';
import type { PageIssue } from '../../checks/types';
import { usePagePath } from '../../hooks/usePagePath';
import { useComments } from '../../hooks/useComments';
import { useAnnounce } from '../Announcer';
import type { CommentItem } from '../@types/Comments';
import { AccessibilityPanel, type AccessibilityState } from './AccessibilityPanel';
import { SeoPanel, seoChecks, tally, vitalChecks } from './SeoPanel';
import { ChecksContext, type PostedComment } from './ChecksParts';
import { ElementHighlight } from './ElementHighlight';
import { GuestNameProvider, useGuestNameGate } from './GuestName';
import { useIssueComment } from './useIssueComment';

export type ChecksPanelId = 'accessibility' | 'seo';
export type ShownComment = Extract<PostedComment, { status: 'posted' }>;
/** What each panel's report of this page found to act on (accessibility issues, SEO checks to look at); none before a report */
export type ChecksAttention = Partial<Record<ChecksPanelId, number>>;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The Accessibility and SEO panels, one open at a time (`panel`), and what they keep while closed:
 * the last reports, the comments their quick actions posted and the highlighted element. Both check
 * the page in the background once it has loaded and the browser is idle (while the toolbar is
 * expanded), so a panel opens with its report; a panel opened before that checks the page then, and
 * Check again checks it again. A panel that stays open from the previous page checks this page once
 * it has rendered.
 */
export function PageChecks(props: {
    panel?: ChecksPanelId;
    /** The toolbar is collapsed: nothing is outlined on the page */
    collapsed: boolean;
    onClose: () => void;
    /** "Show": the posted comment's thread (or the inbox, for one about the page) */
    onShowComment: (comment: ShownComment) => void;
    /** What the reports of this page found to act on, for the pill's indicators */
    onAttentionChange?: (attention: ChecksAttention) => void;
}) {
    return <GuestNameProvider><PageChecksPanels {...props} /></GuestNameProvider>;
}

function PageChecksPanels({ panel, collapsed, onClose, onShowComment, onAttentionChange }: Parameters<typeof PageChecks>[0]) {
    // Measured from the review layer's start, so interactions before a panel opens count too; stopped when it leaves
    useEffect(() => startWebVitals(), []);
    const path = usePagePath();
    const pathRef = useRef(path);
    pathRef.current = path;
    const panelRef = useRef(panel);
    panelRef.current = panel;
    const announce = useAnnounce();
    const [accessibility, setAccessibility] = useState<AccessibilityState>({ checking: false });
    const [seo, setSeo] = useState<SeoReport>();
    const [posted, setPosted] = useState<ReadonlyMap<string, PostedComment>>(() => new Map());
    const [highlighted, setHighlighted] = useState<{ key: string; element: Element }>();
    // Open on the previous page: this page can still be rendering, so its check waits for it to settle
    const restored = useContext(RestoredPanelContext);
    const [settling, setSettling] = useState(() => !!panel && restored === panel);
    const stopSettling = useRef<() => void>(undefined);
    const postIssue = useIssueComment();
    const pageComments = useComments().query.data;
    // What this panel posted keeps its own words ("Bug report sent"); a finding reported before, by
    // anyone, is found among the page's open threads, so it is still marked after a reload
    // Each comment's element, looked up once per render for all the issues
    const commentAnchors = new Map<CommentItem, Element | null>();
    const reportOf = (issue: PageIssue): PostedComment | undefined => {
        const own = posted.get(issue.key);
        if (own) return own;
        const reported = reportedComment(issue, pageComments, path, commentAnchors);
        return reported && { status: 'posted', commentId: reported.id, page: reported.position.type === 'page', number: reported.number, label: 'Reported' };
    };
    const nameGate = useGuestNameGate();

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
            ? checkAccessibility(pathRef.current, { signal: controller.signal, background: { hurry: () => panelRef.current === 'accessibility' } })
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
            if (panelRef.current === 'accessibility') runAccessibility();
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
            setAccessibility(current => ({ ...current, checking: false, error: !background || panelRef.current === 'accessibility' }));
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
            if (seoPath.current !== pathRef.current) runSeo({ background: true });
            if (auditAvailable() && !savesData() && auditedPath.current !== pathRef.current) runAccessibility({ background: true });
        });
        return () => {
            ready.cancel();
            // An open Accessibility panel (it stays open while collapsed) still waits for it
            if (auditControl.current?.background && panelRef.current !== 'accessibility') auditControl.current.controller.abort();
        };
    }, [collapsed]);

    // Opening a panel checks the page unless it has (or is checking) this page's report
    useEffect(() => {
        if (!panel) {
            setHighlighted(undefined);
            setSettling(false);
            return;
        }
        const check = () => {
            if (panel === 'accessibility' && auditedPath.current !== pathRef.current) runAccessibility();
            if (panel === 'seo' && seoPath.current !== pathRef.current) runSeo();
        };
        if (!settling) {
            check();
            return;
        }
        const settled = pageSettled();
        stopSettling.current = settled.cancel;
        settled.promise.then(() => {
            setSettling(false);
            check();
        });
        return settled.cancel;
    }, [panel]);
    // Check again before the page settled checks it now, once
    const checkNow = (run: () => void) => () => {
        stopSettling.current?.();
        setSettling(false);
        run();
    };

    const actions = {
        reportOf,
        highlighted: highlighted?.key,
        highlight: (issue: PageIssue) => {
            if (highlighted?.key === issue.key) {
                setHighlighted(undefined);
                return;
            }
            const element = pageAnchorElement(issue.element) ?? undefined;
            const target = issue.element?.isConnected && isRendered(issue.element) ? issue.element : element;
            if (!target || !isRendered(target)) {
                announce('This element is not visible on the page.');
                return;
            }
            target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            setHighlighted({ key: issue.key, element: target });
        },
        comment: (issue: PageIssue) => {
            if (reportOf(issue) || !nameGate()) return;
            const mark = (state?: PostedComment) => setPosted(current => {
                const next = new Map(current);
                if (state) next.set(issue.key, state); else next.delete(issue.key);
                return next;
            });
            mark({ status: 'sending' });
            postIssue(issue).then(({ comment, page, label }) => {
                mark({ status: 'posted', commentId: comment.id, page, number: comment.number, label });
                announce(label);
            }, () => mark(undefined)); // The toast says it was not posted
        },
        show: (comment: ShownComment) => {
            setHighlighted(undefined);
            onShowComment(comment);
        }
    };

    return (
        <ChecksContext value={actions}>
            {panel === 'accessibility' && <AccessibilityPanel state={settling ? { ...accessibility, checking: true } : accessibility} path={path} onCheck={checkNow(() => runAccessibility())} onClose={onClose} />}
            {panel === 'seo' && <SeoPanel report={seo} path={path} onCheck={checkNow(() => runSeo())} onClose={onClose} />}
            {onAttentionChange && (
                <ChecksAttentionReporter
                    accessibility={accessibility.report?.path === path ? accessibility.report.count : undefined}
                    seo={seo?.path === path ? seo : undefined}
                    onChange={onAttentionChange} />
            )}
            {panel && !collapsed && highlighted && <ElementHighlight element={highlighted.element} />}
        </ChecksContext>
    );
}

/**
 * Tells the pill what this page's reports found to act on: the audit's issues, and the SEO checks
 * worth a look (Core Web Vitals included, as in the panel's summary, so it follows them as the page
 * is used). Its own component, so Core Web Vitals' updates re-render only it.
 */
function ChecksAttentionReporter({ accessibility, seo, onChange }: {
    accessibility?: number;
    seo?: SeoReport;
    onChange: (attention: ChecksAttention) => void;
}) {
    const vitals = vitalChecks(useWebVitals());
    const seoCount = seo ? tally(seoChecks(seo, vitals), 'warn') : undefined;
    useEffect(() => onChange({ accessibility, seo: seoCount }), [accessibility, seoCount]);
    return null;
}
