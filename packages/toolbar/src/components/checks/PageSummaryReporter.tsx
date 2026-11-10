import { useToolbarFeatures } from '../../hooks/useToolbarFeatures';
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { runtimeAdapters } from '../../adapters';
import { backgroundElementLimit, type AccessibilityReport } from '../../checks/accessibility';
import { auditAvailable } from '../../checks/axeLoader';
import { savesData } from '../../checks/pageIdle';
import type { SeoReport } from '../../checks/seo';
import { useWebVitals } from '../../checks/webVitals';
import { toolbarConfig } from '../../config';
import { sourcePagePath, pagePath } from '../../pageState';
import { useProjectViewer } from '../../project/ProjectGate';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { pageSummary, sendPageSummary, summarySignature, type PageSummary } from './pageSummary';
import { seoChecks, vitalChecks } from './SeoPanel';
import { usePageLayerVisible, usePanelSectionChecks } from './sections/sections';

/** After the last change of the reports, so the page's background checks have settled */
const settleMs = 3000;
/** How long the summary waits for an audit that is on its way (while the review layer shows) */
const auditWaitMs = 30_000;

function subscribeVisibility(listener: () => void) {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
}

/**
 * Tells the project what the checks found on this page, for the app's Page checks view
 * (docs/page-checks-site.md). It renders nothing; `PageChecks` gives it this page's reports once they
 * are there. Only a signed-in project member's review sends it (not guests, public viewers, showcase
 * or feedback mode, and not packaged clients for now).
 */
export function PageSummaryReporter(props: {
    path: string;
    /** This page's audit, once it ran */
    accessibility?: AccessibilityReport;
    /** This page's SEO checks, once they ran */
    seo?: SeoReport;
}) {
    const { mode } = useContext(CommentsBootstrapperContext);
    const { isMember } = useProjectViewer();
    if (mode !== 'review' || !toolbarConfig.project || !isMember || runtimeAdapters()) return null;
    return <MemberSummaryReporter {...props} />;
}

/**
 * Once the reports settle (and the audit, when one is on its way, has its report), sends this page's
 * summary, unless this browser sent the same one recently; never while the toolbar is collapsed or the
 * tab hidden, and a failed send is not retried here.
 */
function MemberSummaryReporter({ accessibility, seo }: Parameters<typeof PageSummaryReporter>[0]) {
    // The page as its comments know it: the project's page state applies
    const { path } = useContext(CommentsBootstrapperContext);
    const { pageState } = useProjectViewer();
    const accessibilityAvailable = useToolbarFeatures().includes('accessibility');
    const layerVisible = usePageLayerVisible();
    const tabVisible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => false);
    const active = layerVisible && tabVisible;
    const vitals = useWebVitals();
    const seoSections = usePanelSectionChecks('seo');
    const accessibilitySections = usePanelSectionChecks('accessibility');
    const [auditOverdue, setAuditOverdue] = useState(false);

    const summary = seo && pageSummary({
        path,
        sourcePath: (() => {
            const current = `${location.pathname}${location.search}${location.hash}`;
            return pagePath(current, pageState) === path ? sourcePagePath(current, pageState) : undefined;
        })(),
        accessibility,
        seo,
        seoChecks: [...seoChecks(seo, vitalChecks(vitals)), ...seoSections],
        accessibilityChecks: accessibilitySections,
        vitals
    });
    const latest = useRef<PageSummary>(undefined);
    latest.current = summary;
    const signature = summary && summarySignature(summary);
    // The background audit runs where the asset loads unasked (PageChecks, counted once the page is
    // checked): its report is worth waiting for
    const smallPage = useRef<boolean>(undefined);
    if (seo && smallPage.current === undefined) smallPage.current = document.getElementsByTagName('*').length <= backgroundElementLimit;
    const awaitingAudit = !accessibility && !auditOverdue && accessibilityAvailable && auditAvailable() && !savesData() && smallPage.current === true;

    useEffect(() => {
        if (!active || !seo || !awaitingAudit) return;
        const timer = window.setTimeout(() => setAuditOverdue(true), auditWaitMs);
        return () => window.clearTimeout(timer);
    }, [active, !!seo, awaitingAudit]);

    useEffect(() => {
        if (!active || !signature || awaitingAudit) return;
        const timer = window.setTimeout(() => {
            if (latest.current) void sendPageSummary(latest.current);
        }, settleMs);
        return () => window.clearTimeout(timer);
    }, [active, signature, awaitingAudit]);

    return null;
}
