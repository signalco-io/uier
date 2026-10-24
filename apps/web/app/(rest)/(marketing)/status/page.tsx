import type { Metadata } from 'next';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection } from '../../../../src/components/marketing/ContentPage';
import { getServiceStatus, STATUS_CACHE_SECONDS, type ServiceState } from '../../../../src/lib/status/serviceStatus';

// Shows only what the live checks in src/lib/status measure, when the page is requested. No uptime
// percentages or history: nothing records them.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Status',
    description: `Live checks of ${brand.name}'s website and comments.`
};

const stateLabels: Record<ServiceState, string> = {
    operational: 'Operational',
    down: 'Not responding'
};

function StateDot({ state }: { state: ServiceState; }) {
    return (
        <span
            aria-hidden="true"
            className={cx(
                'inline-block size-1.5 shrink-0 rounded-full',
                state === 'operational' ? 'bg-[hsl(var(--brand-success))]' : 'bg-destructive'
            )} />
    );
}

/** e.g. 2026-10-24 18:03:12 UTC */
function formatUtc(iso: string) {
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export default async function StatusPage() {
    const report = await getServiceStatus();

    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Status"
                lead={`Live checks of ${brand.name}'s services, run on the server when this page loads.`}>
                <p className="flex items-center gap-2 text-base font-medium" role="status">
                    <StateDot state={report.state} />
                    {report.state === 'operational' ? 'All services are operational.' : 'Some services are not responding.'}
                </p>
            </PageHeader>

            <PageSection id="services" title="Services">
                <ul className="flex flex-col overflow-hidden rounded-2xl border">
                    {report.services.map(service => (
                        <li key={service.id} className="flex flex-col gap-1 border-t p-5 first:border-t-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                            <div className="flex flex-col gap-1">
                                <span className="font-medium">{service.name}</span>
                                <span className="text-sm text-muted-foreground">{service.description}</span>
                            </div>
                            <span className="flex shrink-0 items-center gap-2 text-sm font-medium" data-state={service.state}>
                                <StateDot state={service.state} />
                                {stateLabels[service.state]}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                    Checked <time dateTime={report.checkedAt} className="font-mono tabular-nums">{formatUtc(report.checkedAt)}</time>
                </p>
            </PageSection>

            <PageSection id="how" title="How this works">
                <ul className="flex max-w-[720px] list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-muted-foreground">
                    <li>The checks run when the page loads, and their result is reused for {STATUS_CACHE_SECONDS} seconds. They show the state right now: there is no history and no uptime figure.</li>
                    <li>Comments are checked with a read from the comments database, with the same configuration the comments API uses. Saving a comment also depends on bot protection, which is not checked here.</li>
                    <li>If this page does not load at all, {brand.domain} itself is down.</li>
                    <li>Monitors can use <code className="font-mono text-[0.875em]">/api/status</code>: the same result as JSON, with HTTP 503 when a service is not responding.</li>
                    <li>Something broken that this page does not show? <InlineLink href={brand.issues}>Report an issue</InlineLink>.</li>
                </ul>
            </PageSection>
        </main>
    );
}
