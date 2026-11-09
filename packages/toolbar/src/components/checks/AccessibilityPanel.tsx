import { useId } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Check, ExternalLink, Info, LoaderSpinner, Warning } from '@signalco/ui-icons';
import { impacts, type AccessibilityReport, type AccessibilityRule, type Impact } from '../../checks/accessibility';
import { ChecksPanel } from './ChecksPanel';
import { GuestNameField } from './GuestName';
import { CheckSection, ChecksSummary, IssueList, OtherPageNote, sharedSummary, type ChecksIcon } from './ChecksParts';
import { CheckedAt } from './CheckedAt';
import { CircleAlertIcon, OctagonAlertIcon } from './ChecksIcons';

export type AccessibilityState = { report?: AccessibilityReport; checking: boolean; error?: boolean };

/**
 * Each impact's name, shape and colour, from the priority colours (packages/brand/BRAND.md,
 * "Accessibility impact"): a shape of its own, so colour is never the only signal.
 */
const impactStyles: Record<Impact, { name: string; icon: ChecksIcon; tone: string }> = {
    critical: { name: 'Critical', icon: OctagonAlertIcon, tone: 'text-[hsl(var(--destructive))]' },
    serious: { name: 'Serious', icon: Warning, tone: 'text-[hsl(var(--brand-warning))]' },
    moderate: { name: 'Moderate', icon: CircleAlertIcon, tone: 'text-foreground' },
    minor: { name: 'Minor', icon: Info, tone: 'text-muted-foreground' }
};

const issuesText = (count: number) => `${count} ${count === 1 ? 'issue' : 'issues'}`;

/** A rule on one row: its impact's icon, what it asks for, its id and help link, then the elements that fail it */
function RuleItem({ rule }: { rule: AccessibilityRule }) {
    const id = useId();
    const { name, icon: Icon, tone } = impactStyles[rule.impact];
    // A line every element shares is said once, under the title
    const shared = sharedSummary(rule.issues);
    return (
        <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2" data-uier-rule={rule.id}>
            <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex shrink-0">
                    <Icon size={16} aria-hidden="true" className={tone} />
                    <span className="sr-only">{name}: </span>
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline justify-between gap-3">
                        <h4 id={id} className="m-0 min-w-0 text-sm font-medium text-foreground">{rule.help}</h4>
                        {rule.issues.length > 1 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{rule.issues.length}</span>}
                    </div>
                    {shared && shared !== rule.help && <p className="m-0 break-words text-xs text-secondary-foreground">{shared}</p>}
                    <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-mono">{rule.id}</span>
                        {rule.helpUrl && (
                            <a href={rule.helpUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm text-[hsl(var(--brand-accent-text))] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                                How to fix<span className="sr-only"> {rule.help} (opens in a new tab)</span>
                                <ExternalLink size={12} aria-hidden="true" />
                            </a>
                        )}
                    </p>
                </div>
            </div>
            <div className="pl-6">
                <IssueList issues={rule.issues} label={`Elements: ${rule.help}`} showSummary={!shared} />
            </div>
        </li>
    );
}

/**
 * The Accessibility panel: axe-core's audit of the page (the lazy audit asset). A summary of its
 * issues by impact first, then each impact's rules, every rule marked with its impact's icon, with
 * its help link and the elements that fail it.
 */
export function AccessibilityPanel({ state, path, onCheck, onClose }: {
    state: AccessibilityState;
    /** The page now: a report of another page (after a client-side navigation) says so */
    path: string;
    onCheck: () => void;
    onClose: () => void;
}) {
    const { report, checking, error } = state;
    const shown = !checking ? report : undefined;
    const status = checking ? 'Checking this page...'
        : error ? 'The accessibility check could not run.'
            : report ? (report.count ? `${issuesText(report.count)} found.` : 'No issues found.') : '';
    const counts = Object.fromEntries(impacts.map(impact => [impact,
        shown?.rules.filter(rule => rule.impact === impact).reduce((total, rule) => total + rule.issues.length, 0) ?? 0])) as Record<Impact, number>;
    return (
        <ChecksPanel id="accessibility" title="Accessibility" checking={checking} onCheckAgain={onCheck} onClose={onClose}>
            <div className="flex flex-col gap-2">
                <p role="status" className="m-0 flex items-center gap-2 px-1 text-sm text-foreground">
                    {checking && <LoaderSpinner size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
                    {shown && !error && !shown.count && <Check size={16} aria-hidden="true" className="text-[hsl(var(--brand-success))]" />}
                    {status}
                </p>
                {shown && shown.count > 0 && (
                    <ChecksSummary tiles={impacts.map(impact => ({ key: impact, label: impactStyles[impact].name, count: counts[impact], icon: impactStyles[impact].icon, tone: impactStyles[impact].tone }))} />
                )}
                {shown && (
                    <p className="m-0 px-1 text-xs text-muted-foreground">
                        <CheckedAt time={shown.checkedAt} by="axe-core" />
                        {/* Without issues, what automated checks cannot tell */}
                        {!shown.count && ' Automated checks find only some issues. Also try a keyboard and a screen reader.'}
                    </p>
                )}
            </div>
            {shown && shown.path !== path && <OtherPageNote path={shown.path} />}
            <GuestNameField />
            {error && !checking && (
                <div className="flex flex-col items-start gap-2 px-1 text-sm">
                    <p className="m-0 text-xs text-muted-foreground">The site&apos;s Content-Security-Policy or the connection may block its script.</p>
                    <Button size="sm" variant="outlined" onClick={onCheck}>Try again</Button>
                </div>
            )}
            {shown && impacts.map(impact => {
                const rules = shown.rules.filter(rule => rule.impact === impact);
                if (!rules.length) return null;
                return (
                    <CheckSection key={impact} title={impactStyles[impact].name} count={counts[impact]} data-uier-impact={impact}>
                        {rules.map(rule => <RuleItem key={rule.id} rule={rule} />)}
                    </CheckSection>
                );
            })}
        </ChecksPanel>
    );
}
