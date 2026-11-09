import { Down } from '@signalco/ui-icons';
import type { SeoReport } from '../../checks/seo';
import type { CheckState, PageCheck } from '../../checks/types';
import { useWebVitals, vitalCheck, type VitalName, type WebVitals } from '../../checks/webVitals';
import { ChecksPanel } from './ChecksPanel';
import { GuestNameField } from './GuestName';
import { CheckItem, CheckSection, ChecksSummary, checkStates, OtherPageNote } from './ChecksParts';
import { CheckedAt } from './CheckedAt';

const vitalNames: readonly VitalName[] = ['LCP', 'CLS', 'INP'];

/** The page's headings in order, indented by level, behind a disclosure so the checks stay in view */
function HeadingsOutline({ outline }: { outline: SeoReport['headings']['outline'] }) {
    if (!outline.length) return null;
    return (
        <li className="px-3 py-1">
            <details className="group">
                <summary className="-mx-1 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                    <Down size={16} aria-hidden="true" className="-rotate-90 transition-transform duration-150 ease-out group-open:rotate-0 motion-reduce:transition-none" />
                    Outline
                </summary>
                <ol aria-label="Headings outline" className="m-0 flex list-none flex-col gap-0.5 p-0 pb-2 pl-6">
                    {outline.map(heading => (
                        <li key={heading.key} className="flex min-w-0 items-baseline gap-2 text-sm" style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">h{heading.level}</span>
                            <span className={heading.text ? 'min-w-0 break-words text-secondary-foreground' : 'italic text-muted-foreground'}>{heading.text || 'No text'}</span>
                        </li>
                    ))}
                </ol>
            </details>
        </li>
    );
}

/** How many checks are in each state */
export function tally(checks: readonly PageCheck[], state: CheckState) {
    return checks.filter(check => check.state === state).length;
}

/** Core Web Vitals as checks, in the panel's order */
export function vitalChecks(vitals: WebVitals) {
    return vitalNames.map(name => vitalCheck(name, vitals[name]));
}

/** Every check the panel lists: the report's, then Core Web Vitals (its summary counts them all) */
export function seoChecks(report: SeoReport | undefined, vitals: readonly PageCheck[]) {
    return [...report ? [...report.page, ...report.headings.checks, ...report.links.checks, ...report.images.checks] : [], ...vitals];
}

/**
 * The SEO panel: a summary of what passed and what is worth a look first, then the page's indexing,
 * title, meta description and canonical link, its headings (the outline folded), links and images,
 * and Core Web Vitals measured in this browser (updated while the page is used). Every check is one
 * compact row with its state and a one-line reason.
 */
export function SeoPanel({ report, path, onCheck, onClose }: {
    report?: SeoReport;
    path: string;
    onCheck: () => void;
    onClose: () => void;
}) {
    const vitals = vitalChecks(useWebVitals());
    const checks = seoChecks(report, vitals);
    return (
        <ChecksPanel id="seo" title="SEO" onCheckAgain={onCheck} onClose={onClose}>
            {report && <>
                <ChecksSummary tiles={[
                    { key: 'warn', label: 'To look at', count: tally(checks, 'warn'), icon: checkStates.warn.icon, tone: checkStates.warn.tone },
                    { key: 'pass', label: 'Passed', count: tally(checks, 'pass'), icon: checkStates.pass.icon, tone: checkStates.pass.tone }
                ]}>
                    <p className="m-0 px-1 text-xs text-muted-foreground"><CheckedAt time={report.checkedAt} /></p>
                </ChecksSummary>
                {report.path !== path && <OtherPageNote path={report.path} />}
            </>}
            <GuestNameField />
            {report && <>
                <CheckSection title="Page">
                    {report.page.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
                <CheckSection title="Headings" count={report.headings.outline.length}>
                    {report.headings.checks.map(check => <CheckItem key={check.id} check={check} />)}
                    <HeadingsOutline outline={report.headings.outline} />
                </CheckSection>
                <CheckSection title="Links" count={report.links.total}
                    note={report.links.total ? `${report.links.internal} on this site, ${report.links.external} to other sites` : undefined}>
                    {report.links.checks.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
                <CheckSection title="Images" count={report.images.total}>
                    {report.images.checks.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
            </>}
            <CheckSection title="Core Web Vitals" note="Measured in this browser">
                {vitals.map(check => <CheckItem key={check.id} check={check} />)}
            </CheckSection>
        </ChecksPanel>
    );
}
