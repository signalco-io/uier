import type { ReactNode } from 'react';
import { Check, Info, MyLocation, PanelRightClose, Reset, Warning } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { AddCommentIcon } from '../brand/ToolbarIllustration';
import { Specimen } from './LandingSpecimens';

// Static pictures of the toolbar's Accessibility and SEO panels (packages/toolbar components/checks:
// ChecksPanel, ChecksParts, AccessibilityPanel, SeoPanel), for the landing's feature tile and
// /features/page-checks. Ink like the rest of the review layer, built from the tokens, hidden from
// assistive technologies. The labels, impact shapes and colours are the panels' own (BRAND.md,
// "Accessibility impact"); the example content is the landing's imaginary restaurant site.

/** Lucide's octagon-alert and circle-alert, drawn like the panel's (checks/ChecksIcons.tsx) */
function OctagonAlert({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M12 16h.01" /><path d="M12 8v4" />
            <path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" />
        </svg>
    );
}

function CircleAlert({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
        </svg>
    );
}

/** Each impact's shape and colour (AccessibilityPanel `impactStyles`); muted while it counts nothing */
const impacts = [
    { name: 'Critical', icon: OctagonAlert, tone: 'text-[hsl(var(--destructive))]' },
    { name: 'Serious', icon: ({ className }: { className?: string }) => <Warning size={16} className={className} />, tone: 'text-[hsl(var(--brand-warning))]' },
    { name: 'Moderate', icon: CircleAlert, tone: 'text-foreground' },
    { name: 'Minor', icon: ({ className }: { className?: string }) => <Info size={16} className={className} />, tone: 'text-muted-foreground' }
] as const;

/** A docked checks panel: ink, the title with Check again and Close, then its content */
export function ChecksPanelFrame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
    return (
        <div className={cx('dark flex w-full flex-col gap-3 rounded-2xl border bg-background p-3 text-left text-foreground', className)}>
            <div className="flex items-center justify-between gap-2 pl-1">
                <span className="text-sm font-semibold">{title}</span>
                <span className="flex items-center gap-0.5 text-muted-foreground">
                    <span className="inline-flex size-7 items-center justify-center"><Reset size={16} /></span>
                    <span className="inline-flex size-7 items-center justify-center"><PanelRightClose size={16} /></span>
                </span>
            </div>
            {children}
        </div>
    );
}

/** The summary: a tile for each kind of result with its count */
export function SummaryTiles({ tiles }: { tiles: { label: string; count: number; icon: (props: { className?: string }) => ReactNode; tone: string }[] }) {
    return (
        <div className={cx('grid gap-2', tiles.length > 2 ? 'grid-cols-4' : 'grid-cols-2')}>
            {tiles.map(({ label, count, icon: Icon, tone }) => (
                <div key={label} className={cx('flex min-w-0 flex-col rounded-xl border bg-card py-2', tiles.length > 2 ? 'px-2' : 'px-2.5')}>
                    <span className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                        <Icon className={count ? tone : 'text-muted-foreground'} />
                        {count}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{label}</span>
                </div>
            ))}
        </div>
    );
}

/** A section: its heading and count over one bordered card of rows */
export function ChecksSection({ title, count, note, children }: { title: string; count?: number; note?: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 px-1">
                <span className="text-sm font-semibold">{title}{count !== undefined && <span className="font-normal tabular-nums text-muted-foreground"> {count}</span>}</span>
                {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
            </div>
            <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
        </div>
    );
}

/** An element's row: its short name, Highlight and the one-click Comment (or the comment it became) */
export function IssueRow({ element, posted, highlighted }: { element: string; posted?: number; highlighted?: boolean }) {
    return (
        <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted/60 py-0.5 pl-2 pr-0.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{element}</span>
            <span className={cx('inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground', highlighted && 'bg-accent text-foreground')}><MyLocation size={14} /></span>
            {posted !== undefined
                ? <span className="inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-xs text-muted-foreground"><Check size={14} className="text-[hsl(var(--brand-success))]" />#{posted}</span>
                : <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium"><AddCommentIcon size={14} />Comment</span>}
        </span>
    );
}

/** The Accessibility panel with a report: three issues, the contrast rule open with its elements */
export function AccessibilityPanelSpecimen({ className, highlighted }: { className?: string; highlighted?: boolean }) {
    const counts = [0, 2, 1, 0];
    return (
        <ChecksPanelFrame title="Accessibility" className={className}>
            <div className="flex flex-col gap-2">
                <span className="px-1 text-sm">3 issues found.</span>
                <SummaryTiles tiles={impacts.map((impact, index) => ({ label: impact.name, icon: impact.icon, tone: impact.tone, count: counts[index] ?? 0 }))} />
                <span className="px-1 text-xs text-muted-foreground">Checked at 14:32 with axe-core.</span>
            </div>
            <ChecksSection title="Serious" count={2}>
                <div className="flex flex-col gap-1.5 px-3 py-2">
                    <div className="flex items-start gap-2">
                        <Warning size={16} className="mt-0.5 shrink-0 text-[hsl(var(--brand-warning))]" />
                        <div className="flex min-w-0 flex-col">
                            <span className="text-sm font-medium leading-5">Elements must meet minimum color contrast ratio thresholds</span>
                            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                                <span className="font-mono">color-contrast</span>
                                <span>WCAG 1.4.3 (AA)</span>
                                <span className="text-[hsl(var(--brand-accent-text))]">How to fix</span>
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 pl-6">
                        <IssueRow element="span.price" highlighted={highlighted} />
                        <IssueRow element="p.allergens" posted={23} />
                    </div>
                </div>
            </ChecksSection>
        </ChecksPanelFrame>
    );
}

/** The SEO panel's summary and its Page section: what to look at and what passed */
export function SeoPanelSpecimen({ className }: { className?: string }) {
    const rows: { state: 'pass' | 'warn'; name: string; reason: string }[] = [
        { state: 'pass', name: 'Title', reason: '38 characters, within 10 to 60.' },
        { state: 'warn', name: 'Meta description', reason: 'No meta description. Search results may show any text from the page.' },
        { state: 'pass', name: 'Canonical', reason: 'Points to this page.' }
    ];
    return (
        <ChecksPanelFrame title="SEO" className={className}>
            <div className="flex flex-col gap-2">
                <SummaryTiles tiles={[
                    { label: 'To look at', count: 2, icon: ({ className: tone }) => <Warning size={16} className={tone} />, tone: 'text-[hsl(var(--brand-warning))]' },
                    { label: 'Passed', count: 14, icon: ({ className: tone }) => <Check size={16} className={tone} />, tone: 'text-[hsl(var(--brand-success))]' }
                ]} />
                <span className="px-1 text-xs text-muted-foreground">Checked at 14:32.</span>
            </div>
            <ChecksSection title="Page">
                {rows.map(row => (
                    <div key={row.name} className="flex items-start gap-2 px-3 py-2">
                        {row.state === 'pass'
                            ? <Check size={16} className="mt-0.5 shrink-0 text-[hsl(var(--brand-success))]" />
                            : <Warning size={16} className="mt-0.5 shrink-0 text-[hsl(var(--brand-warning))]" />}
                        <span className="flex min-w-0 flex-col">
                            <span className="text-sm font-medium leading-5">{row.name}</span>
                            <span className="text-xs text-muted-foreground">{row.reason}</span>
                        </span>
                    </div>
                ))}
            </ChecksSection>
        </ChecksPanelFrame>
    );
}

/** The landing's feature tile: the Accessibility panel, docked */
export function ChecksSpecimen() {
    return (
        <Specimen className="items-start pt-6">
            <AccessibilityPanelSpecimen className="max-w-[340px]" />
        </Specimen>
    );
}

/** A feature page's picture area: the muted panel the AI and fix verification pages use */
function FeatureFrame({ children }: { children: ReactNode }) {
    return (
        <div aria-hidden="true" className="flex justify-center overflow-hidden rounded-2xl border bg-muted/50 px-6 py-8">
            {children}
        </div>
    );
}

/**
 * /features/page-checks: the example site's menu with a price highlighted from the panel (the
 * point-mode outline with the selection tint, as `ElementHighlight` draws it), and the Accessibility
 * panel beside it with that element's Highlight pressed
 */
export function ChecksSceneSpecimen() {
    const dishes = [['Tagliatelle al ragù', '€14'], ['Cacio e pepe', '€12'], ['Tiramisù', '€7']];
    return (
        <FeatureFrame>
            <div className="flex w-full max-w-[660px] items-start justify-between gap-8">
                <div className="hidden w-full max-w-[250px] flex-col pt-3 sm:flex">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Menu</span>
                    <div className="mt-3 flex flex-col text-sm">
                        {dishes.map(([dish, price], index) => (
                            <span key={dish} className="flex justify-between gap-3 border-b py-1.5">
                                <span>{dish}</span>
                                <span className={cx('tabular-nums text-muted-foreground', index === 0 && 'rounded-[3px] bg-[hsl(var(--brand-selection))] text-foreground outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]')}>{price}</span>
                            </span>
                        ))}
                    </div>
                    <span className="mt-4 text-xs text-muted-foreground">Ask us about allergens.</span>
                </div>
                <AccessibilityPanelSpecimen highlighted className="max-w-[320px] shrink-0" />
            </div>
        </FeatureFrame>
    );
}

/** /features/page-checks: the SEO panel on its own */
export function SeoSceneSpecimen() {
    return (
        <FeatureFrame>
            <SeoPanelSpecimen className="max-w-[340px]" />
        </FeatureFrame>
    );
}

/** A result in the app's Page checks table: an icon beside its words (PageCheckParts `Marked`) */
function Result({ icon, children }: { icon: 'critical' | 'serious' | 'moderate' | 'warn' | 'pass'; children: ReactNode }) {
    const mark = {
        critical: <OctagonAlert className="size-3.5 shrink-0 text-[hsl(var(--destructive))]" />,
        serious: <Warning size={14} className="shrink-0 text-[hsl(var(--brand-warning))]" />,
        moderate: <CircleAlert className="size-3.5 shrink-0 text-foreground" />,
        warn: <Warning size={14} className="shrink-0 text-[hsl(var(--brand-warning))]" />,
        pass: <Check size={14} className="shrink-0 text-[hsl(var(--brand-success))]" />
    }[icon];
    return <span className="inline-flex items-center gap-1.5">{mark}<span>{children}</span></span>;
}

/**
 * /features/page-checks: the app's Page checks view (src/components/app/pageChecks: AcrossPages and
 * the table of PageChecksView), with three pages of the example site. The columns and words are the
 * view's; Core Web Vitals and Checked leave the picture on narrow screens.
 */
export function PageChecksTableSpecimen() {
    const pages: { path: string; title: string; accessibility: ReactNode; seo: ReactNode; vitals: ReactNode; checked: string; change: string }[] = [
        {
            path: '/visit', title: 'Visit us · Trattoria',
            accessibility: <><Result icon="critical">1 critical</Result><Result icon="serious">2 serious</Result></>,
            seo: <><Result icon="warn">3 to look at</Result><span className="text-muted-foreground">13 passed</span></>,
            vitals: <Result icon="warn">LCP <span className="font-mono text-xs">3.1 s</span></Result>,
            checked: 'Today, 14:32', change: 'First check'
        },
        {
            path: '/menu', title: 'Menu · Trattoria',
            accessibility: <Result icon="serious">2 serious</Result>,
            seo: <><Result icon="warn">2 to look at</Result><span className="text-muted-foreground">14 passed</span></>,
            vitals: <><Result icon="pass">LCP <span className="font-mono text-xs">1.8 s</span></Result><Result icon="pass">CLS <span className="font-mono text-xs">0.02</span></Result></>,
            checked: 'Today, 14:20', change: '1 fewer issue'
        },
        {
            path: '/book', title: 'Book a table · Trattoria',
            accessibility: <Result icon="pass">None found</Result>,
            seo: <><Result icon="pass">None to look at</Result><span className="text-muted-foreground">16 passed</span></>,
            vitals: <span className="text-muted-foreground">Not measured</span>,
            checked: 'Yesterday', change: 'No change'
        }
    ];
    const columns = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]';
    return (
        <FeatureFrame>
            <div className="flex w-full max-w-[820px] flex-col gap-4 rounded-xl border bg-background p-4 text-left">
                <div className="flex flex-col gap-0.5">
                    <span className="text-base font-semibold tracking-[-0.01em]">Page checks</span>
                    <span className="text-sm text-muted-foreground">What the toolbar&rsquo;s checks found on each page, in members&rsquo; browsers at the time of each visit.</span>
                </div>
                {/* Across pages: two of its four cards (AcrossPages), with their descriptions and counts */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[['Shared descriptions', 2, 'Indexable pages of one site address with the same meta description.'], ['Without a description', 1, 'Indexable pages with no meta description.']].map(([title, count, text]) => (
                        <span key={title} className="flex flex-col gap-0.5 rounded-xl border px-3 py-2.5">
                            <span className="text-sm font-medium">{title} <span className="font-normal tabular-nums text-muted-foreground">{count}</span></span>
                            <span className="text-xs text-muted-foreground">{text}</span>
                        </span>
                    ))}
                </div>
                <div className="flex flex-col overflow-hidden rounded-xl border text-sm">
                    <div className={cx(columns, 'border-b px-4 py-2 text-xs font-medium text-muted-foreground')}>
                        <span>Page</span><span>Accessibility</span><span>SEO</span>
                        <span className="hidden md:block">Core Web Vitals</span><span className="hidden md:block">Checked</span>
                    </div>
                    {pages.map(page => (
                        <div key={page.path} className={cx(columns, 'border-b px-4 py-3 last:border-b-0')}>
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate font-mono text-xs">{page.path}</span>
                                <span className="truncate">{page.title}</span>
                            </span>
                            <span className="flex flex-col gap-0.5">{page.accessibility}</span>
                            <span className="flex flex-col gap-0.5">{page.seo}</span>
                            <span className="hidden flex-col gap-0.5 md:flex">{page.vitals}</span>
                            <span className="hidden flex-col gap-0.5 md:flex"><span>{page.checked}</span><span className="text-muted-foreground">{page.change}</span></span>
                        </div>
                    ))}
                </div>
            </div>
        </FeatureFrame>
    );
}
