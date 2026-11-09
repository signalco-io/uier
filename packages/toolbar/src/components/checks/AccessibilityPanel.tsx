import { useId } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { ExternalLink, LoaderSpinner } from '@signalco/ui-icons';
import { impacts, type AccessibilityReport, type AccessibilityRule, type Impact } from '../../checks/accessibility';
import { ChecksPanel } from './ChecksPanel';
import { GuestNameField } from './GuestName';
import { IssueList } from './ChecksParts';
import { CheckedAt } from './CheckedAt';

export type AccessibilityState = { report?: AccessibilityReport; checking: boolean; error?: boolean };

const impactNames: Record<Impact, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

const issuesText = (count: number) => `${count} ${count === 1 ? 'issue' : 'issues'}`;

/** A rule with the elements that fail it */
function RuleItem({ rule }: { rule: AccessibilityRule }) {
    const id = useId();
    return (
        <li className="flex min-w-0 flex-col gap-2 py-3" data-uier-rule={rule.id}>
            <div className="min-w-0">
                <h4 id={id} className="m-0 text-sm font-medium text-foreground">{rule.help}</h4>
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
            <IssueList issues={rule.issues} label={`Elements: ${rule.help}`} />
        </li>
    );
}

/**
 * The Accessibility panel: axe-core's audit of the page (the lazy audit asset), its issues by
 * impact, each rule with its help link and the elements that fail it.
 */
export function AccessibilityPanel({ state, path, onCheck, onClose }: {
    state: AccessibilityState;
    /** The page now: a report of another page (after a client-side navigation) says so */
    path: string;
    onCheck: () => void;
    onClose: () => void;
}) {
    const { report, checking, error } = state;
    const status = checking ? 'Checking this page...'
        : error ? 'The accessibility check could not run.'
            : report ? (report.count ? `${issuesText(report.count)} found.` : 'No issues found.') : '';
    return (
        <ChecksPanel id="accessibility" title="Accessibility" checking={checking} onCheckAgain={onCheck} onClose={onClose}>
            <div className="flex flex-col gap-1">
                <p className="m-0 text-xs text-muted-foreground">
                    Automated checks with axe-core, without the toolbar.{report && !checking && <> <CheckedAt time={report.checkedAt} /></>}
                </p>
                <p role="status" className="m-0 flex items-center gap-2 text-sm text-foreground">
                    {checking && <LoaderSpinner size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
                    {status}
                </p>
            </div>
            <GuestNameField />
            {error && !checking && (
                <div className="flex flex-col items-start gap-2 text-sm">
                    <p className="m-0 text-muted-foreground">Its script could not be loaded or run. The site&apos;s Content-Security-Policy or the connection may block it.</p>
                    <Button size="sm" variant="outlined" onClick={onCheck}>Try again</Button>
                </div>
            )}
            {report && !checking && report.path !== path && (
                <p className="m-0 rounded-lg border p-2.5 text-xs text-muted-foreground">These results are for <span className="font-mono">{report.path}</span>. Check again for this page.</p>
            )}
            {report && !checking && !report.count && (
                <p className="m-0 text-sm text-muted-foreground">
                    Automated checks find only part of accessibility issues. Also try the page with a keyboard and a screen reader.
                </p>
            )}
            {report && !checking && impacts.map(impact => {
                const rules = report.rules.filter(rule => rule.impact === impact);
                if (!rules.length) return null;
                const count = rules.reduce((total, rule) => total + rule.issues.length, 0);
                return (
                    <section key={impact} aria-label={`${impactNames[impact]}, ${issuesText(count)}`} data-uier-impact={impact} className="flex min-w-0 flex-col">
                        <h3 className="m-0 text-sm font-semibold text-foreground">
                            {impactNames[impact]} <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                        </h3>
                        <ul className="m-0 flex list-none flex-col divide-y p-0">
                            {rules.map(rule => <RuleItem key={rule.id} rule={rule} />)}
                        </ul>
                    </section>
                );
            })}
        </ChecksPanel>
    );
}
