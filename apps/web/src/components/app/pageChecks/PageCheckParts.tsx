import { ArrowUpRightIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import { KnownPageLinks } from '@/src/knownPages';
import { cn } from '@/src/lib/utils';
import { pageCheckChange } from '@/src/lib/pageChecks/insights';
import {
    accessibilityTotal,
    impactLabels,
    impacts,
    vitalNames,
    vitalOverTarget,
    vitalTargets,
    type Impact,
    type PageCheckRow
} from '@/src/lib/pageChecks/model';

// The parts of a page's row in the Page checks view, shared by the table and the narrow cards. Each
// result is an icon beside its words, so colour is never the only signal (BRAND.md, "Accessibility
// impact": the priority colours, a shape each; a green check for a pass, an amber triangle to look at).

/** Set as the stroke, like `PriorityFlag`, so the icon keeps its colour wherever it sits */
const impactIcons: Record<Impact, { icon: LucideIcon; stroke: string }> = {
    critical: { icon: OctagonAlertIcon, stroke: 'stroke-[hsl(var(--destructive))]' },
    serious: { icon: TriangleAlertIcon, stroke: 'stroke-[hsl(var(--brand-warning))]' },
    moderate: { icon: CircleAlertIcon, stroke: 'stroke-[hsl(var(--foreground))]' },
    minor: { icon: InfoIcon, stroke: 'stroke-[hsl(var(--muted-foreground))]' }
};
const warnIcon = { icon: TriangleAlertIcon, stroke: 'stroke-[hsl(var(--brand-warning))]' };
const passIcon = { icon: CircleCheckIcon, stroke: 'stroke-[hsl(var(--brand-success))]' };

function Marked({ mark, children }: { mark: { icon: LucideIcon; stroke: string }; children: React.ReactNode }) {
    const Icon = mark.icon;
    return (
        <span className="inline-flex items-center gap-1.5">
            <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', mark.stroke)} />
            <span>{children}</span>
        </span>
    );
}

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;

/** The page's environment, where the project's addresses name it */
export type PageEnvironment = { origin: string; label: string };

/**
 * The page's address (mono: a machine wrote it), which opens it in review in a new tab, signed in;
 * an address no longer among the project's is only text. Under a level of a hierarchy (`base`, like
 * `/cms`) it shows the rest of the address (`/articles`), and the whole address stays its name.
 */
export function PageLink({ projectId, page, environments, base }: {
    projectId: string;
    page: PageCheckRow;
    environments: readonly PageEnvironment[];
    base?: string;
}) {
    const shown = page.sourcePath ?? page.path;
    const above = base && shown.startsWith(base) && shown.length > base.length ? base : '';
    const address = (
        <span className="truncate font-mono text-xs" title={above ? shown : undefined}>
            {above && <span className="sr-only">{above}</span>}{shown.slice(above.length)}
        </span>
    );
    if (!environments.some(item => item.origin === page.origin))
        return address;
    return (
        <a href={KnownPageLinks.projectReview(projectId, `${page.origin}${shown}`)} target="_blank" rel="noopener"
            className="-mx-1 inline-flex w-fit max-w-full min-w-0 items-center gap-1 rounded-md px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
            <span className="sr-only">Open in review: </span>
            {address}
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
    );
}

/** The page's address and its title under it (and its environment, when the project has several) */
export function PageCell({ projectId, page, environments }: { projectId: string; page: PageCheckRow; environments: readonly PageEnvironment[] }) {
    const environment = environments.find(item => item.origin === page.origin);
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <PageLink projectId={projectId} page={page} environments={environments} />
            <span className={cn('min-w-0 text-sm break-words whitespace-normal', !page.title && 'text-muted-foreground')}>{page.title ?? 'No title'}</span>
            {environments.length > 1 && <span className="truncate text-xs text-muted-foreground">{environment?.label ?? page.origin}</span>}
        </div>
    );
}

/** axe-core's issues by impact (only the impacts it found), or why there are none */
export function AccessibilityResult({ page }: { page: PageCheckRow }) {
    if (!page.accessibility) return muted('Not checked');
    if (!accessibilityTotal(page.accessibility)) return <Marked mark={passIcon}>None found</Marked>;
    return (
        <span className="flex flex-col gap-0.5">
            {impacts.filter(impact => page.accessibility![impact] > 0).map(impact => (
                <Marked key={impact} mark={impactIcons[impact]}>{page.accessibility![impact]} {impactLabels[impact].toLowerCase()}</Marked>
            ))}
        </span>
    );
}

/** The SEO checks worth a look, and how many passed */
export function SeoResult({ page }: { page: PageCheckRow }) {
    return (
        <span className="flex flex-col gap-0.5">
            {page.seo.warn > 0 ? <Marked mark={warnIcon}>{page.seo.warn} to look at</Marked> : <Marked mark={passIcon}>None to look at</Marked>}
            {muted(`${page.seo.pass} passed`)}
        </span>
    );
}

/** Core Web Vitals measured in the member's browser, each against its target */
export function VitalsResult({ page }: { page: PageCheckRow }) {
    const measured = vitalNames.filter(name => page.vitals?.[name] !== undefined);
    if (!measured.length) return muted('Not measured');
    return (
        <span className="flex flex-col gap-0.5">
            {measured.map(name => {
                const value = page.vitals![name]!;
                const target = vitalTargets[name];
                const over = vitalOverTarget(name, value);
                return (
                    <Marked key={name} mark={over ? warnIcon : passIcon}>
                        <abbr title={target.name} className="no-underline">{target.label}</abbr> <span className="font-mono text-xs tabular-nums">{target.text(value)}</span>
                        <span className="sr-only">{over ? `, over the ${target.text(target.good)} target` : ', within target'}</span>
                    </Marked>
                );
            })}
        </span>
    );
}

/** What changed since the check before, in counts */
export function changeText(page: PageCheckRow) {
    const change = pageCheckChange(page);
    if (!change) return 'First check';
    const parts = [
        change.accessibility ? `${Math.abs(change.accessibility)} ${change.accessibility < 0 ? 'fewer' : 'more'} ${Math.abs(change.accessibility) === 1 ? 'issue' : 'issues'}` : undefined,
        change.seo ? `${Math.abs(change.seo)} ${change.seo < 0 ? 'fewer' : 'more'} to look at` : undefined
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'No change';
}
