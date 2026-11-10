import { useId, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Check, ExternalLink, Info, LoaderSpinner, Search, Warning } from '@signalco/ui-icons';
import { impacts, type AccessibilityReport, type AccessibilityRule, type Impact } from '../../checks/accessibility';
import { ChecksPanel } from './ChecksPanel';
import { GuestNameField } from './GuestName';
import { CheckSection, ChecksSummary, IssueList, OtherPageNote, sharedSummary, type ChecksIcon } from './ChecksParts';
import { CheckedAt } from './CheckedAt';
import { CircleAlertIcon, OctagonAlertIcon } from './ChecksIcons';
import { AltTextSection } from './sections/AltTextSection';
import { KeyboardSection } from './sections/KeyboardSection';
import { MotionSection } from './sections/MotionSection';
import { ReflowSection } from './sections/ReflowSection';
import { ScreenReaderSection } from './sections/ScreenReaderSection';
import { useMessages } from '../../i18n';

export type AccessibilityState = { report?: AccessibilityReport; checking: boolean; error?: boolean };

/**
 * Each impact's name, shape and colour, from the priority colours (packages/brand/BRAND.md,
 * "Accessibility impact"): a shape of its own, so colour is never the only signal.
 */
const impactStyles: Record<Impact, { icon: ChecksIcon; tone: string }> = {
    critical: { icon: OctagonAlertIcon, tone: 'text-[hsl(var(--destructive))]' },
    serious: { icon: Warning, tone: 'text-[hsl(var(--brand-warning))]' },
    moderate: { icon: CircleAlertIcon, tone: 'text-foreground' },
    minor: { icon: Info, tone: 'text-muted-foreground' }
};

/** What axe-core could not decide: not an issue's impact, a closer look */
const reviewStyle = { icon: Search, tone: 'text-muted-foreground' };

/**
 * A rule on one row: its impact's icon (a closer look for one to review), what it asks for, its id
 * and help link, then the elements that fail it, one comment for all of them, and the ones marked
 * "Not an issue"
 */
function RuleItem({ rule }: { rule: AccessibilityRule }) {
    const id = useId();
    const t = useMessages();
    const { icon: Icon, tone } = rule.review ? reviewStyle : impactStyles[rule.impact];
    const name = rule.review ? t.checks.accessibility.toReview : t.checks.accessibility.impacts[rule.impact];
    // A line every element shares is said once, under the title
    const shared = sharedSummary(rule.issues.length ? rule.issues : rule.dismissed ?? []);
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
                        {rule.standard && <span>{rule.standard === 'Best practice' ? t.checks.accessibility.bestPractice : rule.standard}</span>}
                        {rule.helpUrl && (
                            <a href={rule.helpUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm text-[hsl(var(--brand-accent-text))] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
                                {t.checks.accessibility.howToFix}<span className="sr-only">{t.checks.accessibility.opensNewTab(rule.help)}</span>
                                <ExternalLink size={12} aria-hidden="true" />
                            </a>
                        )}
                    </p>
                </div>
            </div>
            <div className="pl-6">
                <IssueList issues={rule.issues} label={t.checks.accessibility.elements(rule.help)} showSummary={!shared} group={rule.group} dismissed={rule.dismissed} />
            </div>
        </li>
    );
}

/** The elements of rules, without the ones marked "Not an issue" */
const elementCount = (rules: readonly AccessibilityRule[]) => rules.reduce((total, rule) => total + rule.issues.length, 0);

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
    const t = useMessages();
    const a = t.checks.accessibility;
    const shown = !checking ? report : undefined;
    const status = checking ? a.checkingPage
        : error ? a.couldNotRun
            : report ? (report.count ? a.found(a.issues(report.count)) : a.noIssues) : '';
    // A summary tile pressed: only its impact's rules, without the sections to review or check by hand
    const [selected, setFilter] = useState<Impact>();
    const counts = Object.fromEntries(impacts.map(impact => [impact, elementCount(shown?.rules.filter(rule => rule.impact === impact) ?? [])])) as Record<Impact, number>;
    // One that no longer counts anything (Check again, Not an issue) filters nothing
    const filter = selected && counts[selected] ? selected : undefined;
    return (
        <ChecksPanel id="accessibility" title={a.title} checking={checking} onCheckAgain={onCheck} onClose={onClose}>
            <div className="flex flex-col gap-2">
                <p role="status" className="m-0 flex items-center gap-2 px-1 text-sm text-foreground">
                    {checking && <LoaderSpinner size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
                    {shown && !error && !shown.count && <Check size={16} aria-hidden="true" className="text-[hsl(var(--brand-success))]" />}
                    {status}
                </p>
                {shown && shown.count > 0 && (
                    <ChecksSummary tiles={impacts.map(impact => ({ key: impact, label: a.impacts[impact], count: counts[impact], icon: impactStyles[impact].icon, tone: impactStyles[impact].tone }))}
                        selected={filter} onSelect={key => setFilter(key as Impact | undefined)} />
                )}
                {shown && (
                    <p className="m-0 px-1 text-xs text-muted-foreground">
                        <CheckedAt time={shown.checkedAt} by="axe-core" />
                        {/* Without issues, what automated checks cannot tell */}
                        {!shown.count && a.automatedNote}
                    </p>
                )}
            </div>
            {shown && shown.path !== path && <OtherPageNote path={shown.path} />}
            <GuestNameField />
            {error && !checking && (
                <div className="flex flex-col items-start gap-2 px-1 text-sm">
                    <p className="m-0 text-xs text-muted-foreground">{a.blocked}</p>
                    <Button size="sm" variant="outlined" onClick={onCheck}>{t.common.retry}</Button>
                </div>
            )}
            {shown && impacts.map(impact => {
                const rules = shown.rules.filter(rule => rule.impact === impact);
                if (!rules.length || (filter && filter !== impact)) return null;
                return (
                    <CheckSection key={impact} title={a.impacts[impact]} count={counts[impact]} data-uier-impact={impact}>
                        {rules.map(rule => <RuleItem key={rule.id} rule={rule} />)}
                    </CheckSection>
                );
            })}
            {/* What axe-core could not decide: for a person to judge, not counted as issues */}
            {!filter && !!shown?.review?.length && (
                <CheckSection title={a.toReview} count={elementCount(shown.review)} note={a.undecided} data-uier-review="">
                    {shown.review.map(rule => <RuleItem key={rule.id} rule={rule} />)}
                </CheckSection>
            )}
            {/* What the audit cannot judge: the on-demand sections, each with its own report */}
            {!filter && <>
                <KeyboardSection />
                <ScreenReaderSection />
                <AltTextSection />
                <ReflowSection />
                <MotionSection />
            </>}
        </ChecksPanel>
    );
}
