'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, UserIcon, UsersIcon, type LucideIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPageLinks } from '@/src/knownPages';
import { integrationLabels, isIntegrationProvider } from '@/src/lib/integrations/model';
import { cn } from '@/src/lib/utils';
import { buttonVariants } from '@/src/components/ui/button';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { projectIntegrations } from '../integrations/projectIntegrations';
import { Bar, ListOutline, Loading, SectionOutline, StatGridOutline } from '../loading/outlines';
import { canConfigureProjects, useShellInfo } from '../shell/ShellInfo';
import { ProjectSettingsNav } from './ProjectSettingsNav';
import { projectSettingsTitles as titles } from './projectSettingsSections';

// A project's settings while they load (docs/design/loading-states, 11 to 13 and 26): each section in its own shape,
// with the real titles of its cards (fixed text, `projectSettingsTitles`) over outlines of what the project decides.
// One status per section. A card, row or title that only some projects or people have is not drawn, unless the
// shell already knows it (`useShellInfo`: the person's role, uier's own workspace, the project's status).

/** The settings column's own layout (`SettingsLayout`): its cards one under another */
const stack = 'flex flex-col gap-6';

/** General's Usage card: its title over the six numbers' cells */
function ProjectUsageOutline({ pulse = false }: { pulse?: boolean }) {
    const { t } = useAppI18n();
    return <SectionOutline title={t(titles.usage)} footer={false} pulse={pulse}><StatGridOutline cells={6} pulse={pulse} /></SectionOutline>;
}

/**
 * General's Usage card while its numbers load, under the loaded form: the card the numbers arrive in. It is inside a
 * page that is already there, so it pulses; the same card in the page's own skeleton is still.
 */
export function ProjectUsageLoading() {
    return <Loading label="Loading usage"><ProjectUsageOutline pulse /></Loading>;
}

/** A switch before its label, as the email switches lay them out */
function SwitchOutline() {
    return (
        <div className="flex items-center gap-3">
            <Bar className="h-5 w-9 rounded-full" />
            <Bar className="h-4 w-44 max-w-full" />
        </div>
    );
}

/** Notifications: everyone's own emails, and what the emails carry for those who configure the project */
export function ProjectNotificationsLoading() {
    const { t } = useAppI18n();
    const canConfigure = canConfigureProjects(useShellInfo());
    return (
        <Loading label="Loading notifications" className={stack}>
            <SectionOutline title={t(titles.emails)} footer={false}><SwitchOutline /></SectionOutline>
            {canConfigure && <SectionOutline title={t(titles.emailContent)} description={false} footer={false}><SwitchOutline /></SectionOutline>}
        </Loading>
    );
}

/** General: the form's card, then Usage. Whoever does not configure the project is sent on to their own emails. */
export function ProjectGeneralLoading() {
    const { t } = useAppI18n();
    if (!canConfigureProjects(useShellInfo()))
        return <ProjectNotificationsLoading />;
    return (
        <Loading label="Loading settings" className={stack}>
            <SectionOutline title={t(titles.general)} description={false} fields={4} />
            <ProjectUsageOutline />
        </Loading>
    );
}

/** Review: one form in one card; uier's own workspace sets only its labels */
export function ProjectReviewLoading() {
    const { t } = useAppI18n();
    const feedback = useShellInfo()?.workspace.feedback === true;
    return (
        <Loading label="Loading review" className={stack}>
            <SectionOutline title={t(feedback ? titles.labels : titles.review)} description={false} fields={feedback ? 1 : 4} />
        </Loading>
    );
}

/** Environments: the addresses' card with one address (its three fields in a row where the card is wide enough) and Add address */
export function ProjectEnvironmentsLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading environments" className={stack}>
            <SectionOutline title={t(titles.addresses)}>
                <div className="@container flex flex-col gap-4">
                    <div className="grid gap-3 @xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.25fr)_2.25rem] @xl:gap-2">
                        <Bar className="h-9 rounded-lg" />
                        <Bar className="h-9 rounded-lg" />
                        <Bar className="h-9 rounded-lg" />
                    </div>
                    <Bar className="h-8 w-28 rounded-lg" />
                </div>
            </SectionOutline>
        </Loading>
    );
}

/**
 * Installation: which page arrives is the project's own (one row once its site has sent feedback, the guide's tabs
 * and steps until then), so neither is drawn: one row's outline stands where both begin.
 */
export function ProjectInstallationLoading() {
    return (
        <Loading label="Loading installation" className={stack}>
            <div className="flex flex-col gap-2 rounded-md border px-4 py-3.5">
                <Bar className="h-4 w-36" />
                <Bar className="h-3.5 w-80 max-w-full" />
            </div>
        </Loading>
    );
}

/** A list's heading in People and teams: its icon and name (the count arrives with the list) */
function ListHeadingOutline({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
    return (
        <span className="flex items-center gap-2 text-sm font-medium">
            <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            {children}
        </span>
    );
}

/** People and teams: one card with the two lists under their headings */
export function ProjectPeopleLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading people" className={stack}>
            {/* The title's line is as tall as the buttons that arrive beside it (Manage teams, Manage users, Invite) */}
            <SectionOutline title={<span className="flex min-h-8 items-start">{t(titles.people)}</span>} description={false} footer={false}>
                <div className="flex flex-col gap-3">
                    <ListHeadingOutline icon={UsersIcon}>{t(titles.teams)}</ListHeadingOutline>
                    <ListOutline rows={1} className="rounded-lg" />
                </div>
                <div className="flex flex-col gap-3">
                    <ListHeadingOutline icon={UserIcon}>{t(titles.peopleWithAccess)}</ListHeadingOutline>
                    <ListOutline rows={3} className="rounded-lg" />
                </div>
            </SectionOutline>
        </Loading>
    );
}

/**
 * Integrations: the services to connect, a card each, under their heading. The connected ones (a list above the
 * heading) are the project's own and arrive with the page.
 */
export function ProjectIntegrationsLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading integrations" className={stack}>
            <div className="@container flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{t(titles.availableIntegrations)}</h2>
                    <p className="m-0 text-sm text-muted-foreground">{t(titles.availableIntegrationsDescription)}</p>
                </div>
                <div className="grid gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
                    {projectIntegrations.map(({ provider }) => (
                        <div key={provider} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
                            <Bar className="size-10 rounded-lg" />
                            <div className="flex flex-col gap-2">
                                <Bar className="h-4 w-24" />
                                <Bar className="h-3.5 w-full" />
                                <Bar className="h-3.5 w-3/4" />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <Bar className="h-5 w-32 rounded-full" />
                                <Bar className="h-5 w-20 rounded-full" />
                            </div>
                            <div className="flex gap-2">
                                <Bar className="h-8 w-24 rounded-lg" />
                                <Bar className="h-8 w-16 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Loading>
    );
}

/**
 * The way back from a service's page to the list. Outside the page's data boundary, so it is the same link before
 * and after the page arrives; only for those who configure the project (nobody else has the page).
 */
export function AllIntegrationsLink() {
    const { t } = useAppI18n();
    const { projectId } = useParams<{ projectId: string }>();
    if (!canConfigureProjects(useShellInfo()))
        return null;
    return (
        <Link href={KnownPageLinks.projectSettings(projectId, 'integrations')} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-mb-2 -ml-2.5 w-fit')}>
            <ArrowLeft data-icon="inline-start" />{t(titles.allIntegrations)}
        </Link>
    );
}

/**
 * One service's page: its card, named from the address, then What it does. The optional syncs between them depend
 * on the connection and arrive with the page.
 */
export function ProjectIntegrationLoading() {
    const { t } = useAppI18n();
    const { provider } = useParams<{ provider?: string }>();
    return (
        <Loading label="Loading integration" className={stack}>
            <SectionOutline title={isIntegrationProvider(provider) ? <IntegrationTitle provider={provider} name={integrationLabels[provider]} /> : undefined} footer={false} />
            <SectionOutline title={t(titles.integrationFeatures)} footer={false}>
                <ListOutline rows={3} avatar={false} trailing={false} className="rounded-lg" />
            </SectionOutline>
        </Loading>
    );
}

/** A change to the whole project: its name and a line about it, with its button at the row's end */
function DangerRowOutline({ title, first = false }: { title?: string; first?: boolean }) {
    return (
        <div className={cn('flex flex-wrap items-center justify-between gap-3', !first && 'border-t pt-6')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {title
                    ? <span className="text-sm font-medium">{title}</span>
                    : <span className="flex h-5 items-center"><Bar className="h-4 w-28" /></span>}
                <span className="flex h-5 items-center"><Bar className="h-3.5 w-80 max-w-full" /></span>
            </div>
            <Bar className="h-9 w-28 shrink-0 rounded-lg" />
        </div>
    );
}

/** Danger zone: its three rows. The first is Mark as done or Reopen project, by the status the sidebar already shows. */
export function ProjectDangerZoneLoading() {
    const { t } = useAppI18n();
    const { projectId } = useParams<{ projectId: string }>();
    const status = useShellInfo()?.projects[projectId]?.status;
    return (
        <Loading label="Loading danger zone" className={stack}>
            <SectionOutline title={t(titles.dangerZone)} description={false} footer={false} className="border-destructive/40">
                <DangerRowOutline first title={status && t(status === 'done' ? titles.reopenProject : titles.markAsDone)} />
                <DangerRowOutline title={t(titles.transferProject)} />
                <DangerRowOutline title={t(titles.deleteProject)} />
            </SectionOutline>
        </Loading>
    );
}

/** The loading state of the settings section the address names */
function ProjectSettingsSectionLoading() {
    const { projectId, provider } = useParams<{ projectId: string; provider?: string }>();
    const pathname = usePathname();
    const settings = KnownPageLinks.projectSettings(projectId);
    if (pathname === settings)
        return <ProjectGeneralLoading />;
    switch (pathname.slice(settings.length + 1).split('/')[0]) {
        case 'review': return <ProjectReviewLoading />;
        case 'environments': return <ProjectEnvironmentsLoading />;
        case 'installation': return <ProjectInstallationLoading />;
        case 'people': return <ProjectPeopleLoading />;
        case 'integrations': return provider ? <><AllIntegrationsLink /><ProjectIntegrationLoading /></> : <ProjectIntegrationsLoading />;
        case 'notifications': return <ProjectNotificationsLoading />;
        case 'danger-zone': return <ProjectDangerZoneLoading />;
        // An address no section has: a card's outline until the page says so
        default: return <Loading label="Loading settings" className={stack}><SectionOutline /></Loading>;
    }
}

/**
 * The settings while the whole project is still loading (`ProjectLoading`, for an address under `/settings`): the
 * section links and the loading state of the section the address names, where both will be once the project is there.
 */
export function ProjectSettingsLoading() {
    return <ProjectSettingsNav><ProjectSettingsSectionLoading /></ProjectSettingsNav>;
}
