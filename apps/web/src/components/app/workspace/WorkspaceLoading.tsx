'use client';

import Link from 'next/link';
import { Button } from '@/src/components/ui/button';
import { useSearchParams } from 'next/navigation';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { Card } from '@/src/components/ui/card';
import { cn } from '@/src/lib/utils';
import { Bar, FormOutline, HeaderOutline, ListOutline, Loading, SectionOutline } from '../loading/outlines';
import { ProjectMark } from '../projects/ProjectMark';
import { canConfigureProjects, useShellInfo } from '../shell/ShellInfo';
import { InviteButton } from '../users/InviteDialog';
import { ListSection } from './ListSection';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceTabHeader } from './WorkspaceTabHeader';
import { workspaceTabs } from './workspaceTabs';

// The workspace area while a page of it loads (docs/design/loading-states #16 to #18). The area's header and tabs are
// real (`WorkspaceHeader`); each tab draws what every person has of it (its opening line, an action that needs no
// data) and outlines only where its data goes, in that data's shape. One status per page, still bars throughout:
// these are shells a navigation shows at once.

const rowWidths = ['w-40', 'w-56', 'w-32', 'w-48'];

/** `ListOutline` for rows that start with a square mark (a team, a client, a project) where a person's has a picture */
function MarkListOutline({ rows = 3, trailing = true, className }: { rows?: number; trailing?: boolean; className?: string }) {
    return (
        <div aria-hidden="true" className={cn('flex flex-col divide-y rounded-xl border', className)}>
            {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3">
                    <Bar className="size-8 shrink-0 rounded-lg" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Bar className={cn('h-4 max-w-full', rowWidths[row % rowWidths.length])} />
                        <Bar className="h-3 w-24" />
                    </span>
                    {trailing && <Bar className="h-4 w-16 shrink-0" />}
                </div>
            ))}
        </div>
    );
}

/** A line of text of `height` (a Tailwind height class, the text's line height) as a bar */
function LineOutline({ height = 'h-5', className }: { height?: string; className?: string }) {
    return <span className={cn('flex items-center', height)}><Bar className={cn('h-3.5 max-w-full', className)} /></span>;
}

/** A settings field as the forms lay it out: its label, its control and `help` lines of description under it */
function FieldOutline({ help = 0 }: { help?: number }) {
    return (
        <div className="flex flex-col gap-3">
            <LineOutline className="h-4 w-28" />
            <Bar className="h-9 w-full max-w-md rounded-lg" />
            {help > 0 && (
                <span className="flex flex-col">
                    {Array.from({ length: help }, (_, line) => <LineOutline key={line} className={line === help - 1 ? 'w-80' : 'w-full'} />)}
                </span>
            )}
        </div>
    );
}

/** Users: the tab's line and Invite (it needs no data), then the people and the invitations under their headings */
export function UsersLoading() {
    const { t } = useAppI18n();
    const info = useShellInfo();
    // The list filtered to a project (`?project=`), as the page will say it: the shell has the project's name
    const project = useSearchParams().get('project') ?? undefined;
    const filtered = project ? info?.projects[project]?.name : undefined;
    return (
        <>
            {/* Team membership shows when the workspace has teams, which the shell knows: in its place at once, off until
                the page (its dialog needs the people), so Invite does not move. The filters depend on the people. */}
            <WorkspaceTabHeader
                description={t("The people who review the projects in this workspace.")}
                actions={(
                    <>
                        {info?.workspace.teams && <Button variant="outline" disabled aria-hidden="true" tabIndex={-1}>{t("Team membership")}</Button>}
                        <InviteButton projectId={filtered ? project : undefined} />
                    </>
                )} />
            <Loading label="Loading users" className="flex flex-col gap-10">
                <ListSection
                    title={t("People")}
                    description={filtered ? t("Who can review {value0}.", { value0: filtered }) : t("Admins and commenters of this workspace.")}>
                    <ListOutline rows={3} />
                </ListSection>
                <ListSection title={t("Invitations")} description={t("Sent and not accepted yet.")}>
                    <ListOutline rows={1} />
                </ListSection>
            </Loading>
        </>
    );
}

/** Teams: its toolbar is real, outside the data boundary (`TeamsToolbar`); this is the list under it */
export function TeamsLoading() {
    return <Loading label="Loading teams"><MarkListOutline /></Loading>;
}

/** The body of Group existing people (Teams), opened before the workspace's people and projects arrived */
export function GroupPeopleLoading() {
    return <Loading label="Loading people"><FormOutline /></Loading>;
}

/** Clients: the tab's line, then the list */
export function ClientsLoading() {
    const { t } = useAppI18n();
    const info = useShellInfo();
    // Add client lists the projects' clients, so it comes with the page. The shell knows whether it will (the page's
    // own rule: an admin with a project), and its place is kept so the list under it does not move when it does.
    const adds = canConfigureProjects(info) && Object.keys(info?.projects ?? {}).length > 0;
    return (
        <>
            <WorkspaceTabHeader
                description={t("Who your projects are for. Add a client here, or set a project's client when you create it or in its settings.")}
                actions={adds && <span aria-hidden="true" className="h-9 w-28" />} />
            <Loading label="Loading clients"><MarkListOutline /></Loading>
        </>
    );
}

/** A usage meter: its name and count, the bar, the line under it */
function MeterOutline() {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-2">
                <span className="flex h-5 min-w-0 flex-1 items-center"><Bar className="h-3.5 w-32 max-w-full" /></span>
                <span className="flex h-5 shrink-0 items-center"><Bar className="h-3.5 w-16" /></span>
                <Bar className="h-1.5 w-full rounded-full" />
            </div>
            <LineOutline height="h-4" className="h-3 w-56" />
        </div>
    );
}

/**
 * Usage: the tab's line with a bar where the time to the next reset goes, then one block per project. The shell
 * already lists the projects the person can see, which are the ones the tab shows: their marks and names are real,
 * their meters are bars.
 */
export function UsageLoading() {
    const { t } = useAppI18n();
    const projects = Object.entries(useShellInfo()?.projects ?? {});
    return (
        <>
            <WorkspaceTabHeader description={(
                <>{t("What each project shares in a day, whoever sends it. Counts start again at midnight UTC,")}{' '}<span aria-hidden="true" className="inline-block h-3.5 w-28 rounded-md bg-muted align-middle" />.
                    {' '}{t("Your own limits are in")}{' '}<Link href={KnownPageLinks.accountUsage()} className="underline underline-offset-4 hover:text-foreground">{t("your account")}</Link>.
                </>
            )} />
            <Loading label="Loading usage">
                {projects.length > 0
                    ? (
                        <Card className="gap-0 py-0">
                            <div className="flex flex-col divide-y">
                                {projects.map(([id, project]) => (
                                    <div key={id} className="flex flex-col gap-4 p-6">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <ProjectMark name={project.name} projectId={id} url={project.url} />
                                            <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
                                        </div>
                                        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                                            <MeterOutline />
                                            <MeterOutline />
                                        </div>
                                        <LineOutline height="h-4" className="h-3 w-64" />
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )
                    // No projects: the page will say so in this box
                    : <div className="h-48 rounded-lg border border-dashed" />}
            </Loading>
        </>
    );
}

/** Activity: its line is real, outside the data boundary (`WorkspaceTabIntro`); this is the list of changes under it */
export function ActivityLoading() {
    return <Loading label="Loading activity"><ListOutline avatar={false} /></Loading>;
}

/**
 * Workspace settings: every section an admin has, under its real title. uier's own workspace has its labels only
 * (the shell knows which workspace this is).
 */
export function WorkspaceSettingsLoading() {
    const { t } = useAppI18n();
    const feedback = useShellInfo()?.workspace.feedback === true;
    return (
        <Loading label="Loading settings" className="flex max-w-3xl flex-col gap-6">
            {!feedback && (
                <>
                    <SectionOutline title={t("General")} description={false}><FieldOutline help={1} /></SectionOutline>
                    <SectionOutline title={t("Toolbar language")} description={false}><FieldOutline help={2} /></SectionOutline>
                    <SectionOutline title={t("AI")} description={false} footer={false}>
                        <div className="flex gap-3">
                            <Bar className="h-5 w-9 shrink-0 rounded-full" />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <LineOutline className="h-4 w-28" />
                                <LineOutline className="w-full" />
                                <LineOutline className="w-2/3" />
                            </span>
                        </div>
                    </SectionOutline>
                    <SectionOutline title={t("Rewrite suggestions")} fields={1} />
                    <SectionOutline title={t("Feedback types")} fields={3} />
                </>
            )}
            <SectionOutline title={t("Labels")} fields={3} />
            {!feedback && (
                <>
                    <SectionOutline title={t("Statuses")} fields={3} />
                    <SectionOutline title={t("Email domains")} fields={1} footer={false} />
                    <SectionOutline title={t("Projects from Notion")} fields={1} footer={false} />
                </>
            )}
        </Loading>
    );
}

/** A team: its name is data (`HeaderOutline`); the four sections every team has, under their real titles */
export function TeamLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading team">
            <HeaderOutline />
            <div className="flex flex-col gap-8">
                {/* Active or archived */}
                <LineOutline className="w-14" />
                <SectionOutline title={t("People")} footer={false}><ListOutline avatar={false} trailing={false} rows={3} /></SectionOutline>
                <SectionOutline title={t("Projects")} footer={false}><ListOutline avatar={false} trailing={false} rows={3} /></SectionOutline>
                <SectionOutline title={t("Team state")} description={false} footer={false}><Bar className="h-9 w-56 max-w-full rounded-lg" /></SectionOutline>
                <SectionOutline title={t("Activity")} footer={false}><ListOutline avatar={false} rows={3} /></SectionOutline>
            </div>
        </Loading>
    );
}

/** A person: their picture and name are data (`HeaderOutline` with a round tile); then what they can review, and their access */
export function PersonLoading() {
    const { t } = useAppI18n();
    return (
        <Loading label="Loading person">
            <HeaderOutline media="round" />
            <div className="flex flex-col gap-8">
                <SectionOutline title={t("Project access")} footer={false}><MarkListOutline trailing={false} className="rounded-lg" /></SectionOutline>
                <SectionOutline title={t("Role, teams and direct access")} fields={3} />
            </div>
        </Loading>
    );
}

/**
 * `/app/workspace` while it finds the person's first tab and redirects there: the area's header with that tab
 * current, over that tab's own loading state, so the redirect changes nothing on screen. The first tab is Users for
 * those who manage the workspace and Clients for everyone else (`workspaceTabs`).
 */
export function WorkspaceEntering() {
    const workspace = useShellInfo()?.workspace;
    if (!workspace)
        return <Loading label="Loading workspace"><HeaderOutline /></Loading>;
    const first = workspaceTabs(workspace)[0]?.href;
    return (
        <>
            <WorkspaceHeader entering />
            {first === KnownPages.AppUsers ? <UsersLoading /> : <ClientsLoading />}
        </>
    );
}
