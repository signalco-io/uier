import type { SeoReport } from '../../checks/seo';
import { useWebVitals, vitalCheck, type VitalName } from '../../checks/webVitals';
import { ChecksPanel } from './ChecksPanel';
import { GuestNameField } from './GuestName';
import { CheckItem, CheckSection } from './ChecksParts';
import { CheckedAt } from './CheckedAt';

const vitalNames: readonly VitalName[] = ['LCP', 'CLS', 'INP'];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The page's headings in order, indented by level */
function HeadingsOutline({ outline }: { outline: SeoReport['headings']['outline'] }) {
    if (!outline.length) return null;
    return (
        <li className="py-2.5">
            <p className="m-0 mb-1 text-xs text-muted-foreground">Outline</p>
            <ol aria-label="Headings outline" className="m-0 flex list-none flex-col gap-0.5 p-0">
                {outline.map(heading => (
                    <li key={heading.key} className="flex min-w-0 items-baseline gap-2 text-sm" style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">h{heading.level}</span>
                        <span className={heading.text ? 'min-w-0 break-words text-foreground' : 'italic text-muted-foreground'}>{heading.text || 'No text'}</span>
                    </li>
                ))}
            </ol>
        </li>
    );
}

/**
 * The SEO panel: the page's title, meta description and canonical link, its headings, links and
 * images, then Core Web Vitals measured in this browser (updated while the page is used). Every
 * check has a pass or warning state and a one-line reason.
 */
export function SeoPanel({ report, path, onCheck, onClose }: {
    report?: SeoReport;
    path: string;
    onCheck: () => void;
    onClose: () => void;
}) {
    const vitals = useWebVitals();
    return (
        <ChecksPanel id="seo" title="SEO" onCheckAgain={onCheck} onClose={onClose}>
            <GuestNameField />
            {report && <>
                <p className="m-0 text-xs text-muted-foreground">
                    What this page tells search engines. <CheckedAt time={report.checkedAt} />
                </p>
                {report.path !== path && (
                    <p className="m-0 rounded-lg border p-2.5 text-xs text-muted-foreground">These results are for <span className="font-mono">{report.path}</span>. Check again for this page.</p>
                )}
                <CheckSection title="Page">
                    {report.page.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
                <CheckSection title="Headings" note={count(report.headings.outline.length, 'heading')}>
                    {report.headings.checks.map(check => <CheckItem key={check.id} check={check} />)}
                    <HeadingsOutline outline={report.headings.outline} />
                </CheckSection>
                <CheckSection title="Links" note={`${count(report.links.total, 'link')}: ${report.links.internal} on this site, ${report.links.external} to other sites.`}>
                    {report.links.checks.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
                <CheckSection title="Images" note={count(report.images.total, 'image')}>
                    {report.images.checks.map(check => <CheckItem key={check.id} check={check} />)}
                </CheckSection>
            </>}
            <CheckSection title="Core Web Vitals" note="Measured in this browser since the page loaded, without the toolbar. They update as you use the page.">
                {vitalNames.map(name => <CheckItem key={name} check={vitalCheck(name, vitals[name])} />)}
            </CheckSection>
        </ChecksPanel>
    );
}
