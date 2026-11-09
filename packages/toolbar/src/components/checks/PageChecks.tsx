import { useContext, useEffect, useRef, useState } from 'react';
import { checkAccessibility } from '../../checks/accessibility';
import { checkSeo, type SeoReport } from '../../checks/seo';
import { startWebVitals } from '../../checks/webVitals';
import { pageSettled } from '../../checks/pageSettled';
import { RestoredPanelContext } from '../../openPanel';
import { isRendered, pageAnchorElement } from '../../checks/pageElements';
import { reportedComment } from '../../checks/reportedIssue';
import type { PageIssue } from '../../checks/types';
import { usePagePath } from '../../hooks/usePagePath';
import { useComments } from '../../hooks/useComments';
import { useAnnounce } from '../Announcer';
import type { CommentItem } from '../@types/Comments';
import { AccessibilityPanel, type AccessibilityState } from './AccessibilityPanel';
import { SeoPanel } from './SeoPanel';
import { ChecksContext, type PostedComment } from './ChecksParts';
import { ElementHighlight } from './ElementHighlight';
import { GuestNameProvider, useGuestNameGate } from './GuestName';
import { useIssueComment } from './useIssueComment';

export type ChecksPanelId = 'accessibility' | 'seo';
export type ShownComment = Extract<PostedComment, { status: 'posted' }>;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The Accessibility and SEO panels, one open at a time (`panel`), and what they keep while closed:
 * the last reports, the comments their quick actions posted and the highlighted element. The
 * accessibility audit runs when its panel opens without a report of this page, or on Check again.
 * A panel that stays open from the previous page checks this page once it has rendered.
 */
export function PageChecks(props: {
    panel?: ChecksPanelId;
    /** The toolbar is collapsed: nothing is outlined on the page */
    collapsed: boolean;
    onClose: () => void;
    /** "Show": the posted comment's thread (or the inbox, for one about the page) */
    onShowComment: (comment: ShownComment) => void;
}) {
    return <GuestNameProvider><PageChecksPanels {...props} /></GuestNameProvider>;
}

function PageChecksPanels({ panel, collapsed, onClose, onShowComment }: Parameters<typeof PageChecks>[0]) {
    // Measured from the review layer's start, so interactions before a panel opens count too; stopped when it leaves
    useEffect(() => startWebVitals(), []);
    const path = usePagePath();
    const pathRef = useRef(path);
    pathRef.current = path;
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
    const runAccessibility = () => {
        const audit = ++latestAudit.current;
        setAccessibility(current => ({ ...current, checking: true, error: false }));
        setHighlighted(undefined);
        checkAccessibility(pathRef.current).then(report => {
            if (audit === latestAudit.current) setAccessibility({ report, checking: false });
        }, error => {
            if (audit !== latestAudit.current) return;
            console.warn('uier-toolbar: The accessibility check could not run', error);
            setAccessibility(current => ({ ...current, checking: false, error: true }));
        });
    };
    const runSeo = () => {
        setHighlighted(undefined);
        setSeo(checkSeo(pathRef.current));
    };

    // Opening a panel checks the page unless it has this page's report
    useEffect(() => {
        if (!panel) {
            setHighlighted(undefined);
            setSettling(false);
            return;
        }
        const check = () => {
            if (panel === 'accessibility' && !accessibility.checking && accessibility.report?.path !== pathRef.current) runAccessibility();
            if (panel === 'seo' && seo?.path !== pathRef.current) runSeo();
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
            {panel === 'accessibility' && <AccessibilityPanel state={settling ? { ...accessibility, checking: true } : accessibility} path={path} onCheck={checkNow(runAccessibility)} onClose={onClose} />}
            {panel === 'seo' && <SeoPanel report={seo} path={path} onCheck={checkNow(runSeo)} onClose={onClose} />}
            {panel && !collapsed && highlighted && <ElementHighlight element={highlighted.element} />}
        </ChecksContext>
    );
}
