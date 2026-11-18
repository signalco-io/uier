import { publicPageMetadata } from '@/src/lib/metadata';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection, Panel } from '../../../../src/components/marketing/ContentPage';
import { getServiceStatus, serviceDefinitions, STATUS_CACHE_SECONDS, type ServiceDefinition, type ServiceState } from '../../../../src/lib/status/serviceStatus';

// Shows only what the live checks in src/lib/status measure, when the page is requested. No uptime
// percentages or history: nothing records them.
//
// Which services are checked is fixed, so their rows are part of the static shell, each one
// "Checking…". Only a row's state and the time under the panel wait for the request; the shell and
// the loaded panel share `ServiceRow` and `checkedLine`, so nothing moves when the results arrive.


export const metadata = publicPageMetadata('/status', {
    title: 'Status',
    description: `Live checks of ${brand.name}'s website and comments.`
});

/** What a row shows where its result goes: `checking` in the static shell, before any check has answered */
type RowState = ServiceState | 'checking';

const stateLabels: Record<RowState, string> = {
    checking: 'Checking…',
    operational: 'Operational',
    down: 'Not responding'
};

// Checking is neutral: no result is implied until a check has answered
const stateDots: Record<RowState, string> = {
    checking: 'bg-muted-foreground',
    operational: 'bg-[hsl(var(--brand-success))]',
    down: 'bg-destructive'
};

function StateDot({ state }: { state: RowState; }) {
    return <span aria-hidden="true" className={cx('inline-block size-1.5 shrink-0 rounded-full', stateDots[state])} />;
}

/**
 * One service of the Services panel, in the shell and in the loaded panel. From `sm` the state keeps
 * the width of the longest label ("Not responding"), so no result changes where the description wraps;
 * below `sm` it has a line of its own.
 */
function ServiceRow({ service, state }: { service: ServiceDefinition; state: RowState; }) {
    return (
        <li className="flex flex-col gap-1 p-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <div className="flex flex-col gap-1">
                <span className="font-medium">{service.name}</span>
                <span className="text-sm text-muted-foreground">{service.description}</span>
            </div>
            <span
                className={cx(
                    'flex shrink-0 items-center gap-2 text-sm sm:min-w-[8.5em] sm:justify-end',
                    state === 'checking' ? 'text-muted-foreground' : 'font-medium'
                )}
                data-state={state}>
                <StateDot state={state} />{stateLabels[state]}
            </span>
        </li>
    );
}

/** The line under the panel: when the checks ran. One line of text, with its height kept while they run */
const checkedLine = 'min-h-5 text-sm text-muted-foreground';

/** e.g. 2026-10-24 18:03:12 UTC */
function formatUtc(iso: string) {
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export default function StatusPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Status"
                lead={`Live checks of ${brand.name}'s services, run when this page loads.`}>
                <Suspense fallback={<p className="min-h-6 text-muted-foreground" role="status">Checking services…</p>}>
                    <StatusSummary />
                </Suspense>
            </PageHeader>

            <PageSection id="services" title="Services">
                <Suspense fallback={<ServiceChecksLoading />}>
                    <ServiceChecks />
                </Suspense>
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

async function liveReport() {
    await connection();
    return getServiceStatus();
}

async function StatusSummary() {
    const report = await liveReport();
    return <p className="flex min-h-6 items-center gap-2 text-base font-medium" role="status">
        <StateDot state={report.state} />
        {report.state === 'operational' ? 'All services are operational.' : 'Some services are not responding.'}
    </p>;
}

/**
 * The Services panel in the static shell: the rows the checks will fill, each one "Checking…". It
 * reads the fixed definitions only, never a check or the request, so it prerenders with the page.
 */
function ServiceChecksLoading() {
    return <>
        <Panel as="ul">
            {serviceDefinitions.map(service => <ServiceRow key={service.id} service={service} state="checking" />)}
        </Panel>
        {/* The panel's one status, read out and not drawn: every row already says "Checking…" */}
        <p className={checkedLine} role="status"><span className="sr-only">Loading service checks…</span></p>
    </>;
}

async function ServiceChecks() {
    const report = await liveReport();
    return <>
        <Panel as="ul">
            {report.services.map(service => <ServiceRow key={service.id} service={service} state={service.state} />)}
        </Panel>
        <p className={checkedLine}>
            Checked <time dateTime={report.checkedAt} className="font-mono tabular-nums">{formatUtc(report.checkedAt)}</time>
        </p>
    </>;
}
