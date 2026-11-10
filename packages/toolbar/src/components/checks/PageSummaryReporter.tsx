import type { AccessibilityReport } from '../../checks/accessibility';
import type { SeoReport } from '../../checks/seo';

/**
 * Tells the project what the checks found on this page, for the app's site view. It renders
 * nothing; `PageChecks` gives it this page's reports once they are there (the sections' checks are
 * in `usePanelSectionChecks`).
 * Not built yet: it reports nothing.
 */
export function PageSummaryReporter(_props: {
    path: string;
    /** This page's audit, once it ran */
    accessibility?: AccessibilityReport;
    /** This page's SEO checks, once they ran */
    seo?: SeoReport;
}) {
    return null;
}
