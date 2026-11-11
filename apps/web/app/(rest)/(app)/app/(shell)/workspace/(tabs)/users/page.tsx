
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KnownPages, KnownPageLinks } from '@/src/knownPages';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { FolderIcon, FoldersIcon, MailIcon } from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { cn } from '@/src/lib/utils';
import { requireAdminContext } from '@/src/lib/app/context';
import { listMembersWithUsers } from '@/src/lib/app/members';
import { listInvitations } from '@/src/lib/app/invitations';
import { listProjects } from '@/src/lib/app/projects';
import { hasProjectAccess, loadWorkspaceAccess } from '@/src/lib/app/access';
import { BulkTeamForm } from '@/src/components/app/teams/BulkTeamForm';
import { UsersFilters } from '@/src/components/app/teams/UsersFilters';
import type { ProjectsAccess } from '@/src/lib/app/model';
import { WorkspaceTabHeader } from '@/src/components/app/workspace/WorkspaceTabHeader';
import { RelativeTime } from '@/src/components/app/comments/DateTime';
import { PersonAvatar } from '@/src/components/app/PersonAvatar';
import { ProjectFilter } from '@/src/components/app/users/ProjectFilter';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { RemoveMemberButton, ResendInvitationButton, RevokeInvitationButton } from '@/src/components/app/users/UserActions';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Users") };
}

function accessText(role: 'admin' | 'commenter', projects: ProjectsAccess, names: Map<string, string>) {
    if (role === 'admin' || projects === 'all')
        return 'All projects';
    const listed = projects.map(id => names.get(id)).filter(Boolean);
    return listed.length ? listed.join(', ') : 'No projects';
}

/** The projects someone can review, with a folder (or folders, for all of them) */
function Access({ role, projects, names }: { role: 'admin' | 'commenter'; projects: ProjectsAccess; names: Map<string, string> }) {
    const Icon = role === 'admin' || projects === 'all' ? FoldersIcon : FolderIcon;
    return (
        <ItemDescription className="flex items-center gap-1.5">
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{accessText(role, projects, names)}</span>
        </ItemDescription>
    );
}

// The avatar stays centred on the row (Item tops it when there is a description)
const centeredMedia = 'group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center';
// A fixed column, so the role badges line up whatever their width
const roleColumn = 'flex w-24 justify-end';
// Where the card is wide enough, the rows share one grid (subgrid), so the person, access and actions
// columns line up whichever actions a row has; narrower cards keep the wrapping row
const columnsGroup = 'gap-0 divide-y @2xl:grid @2xl:grid-cols-[auto_minmax(12rem,1fr)_minmax(0,18rem)_auto]';
const columnsRow = 'rounded-none @2xl:col-span-full @2xl:grid @2xl:grid-cols-subgrid';

/** Internal or External; nothing while unspecified */
const relationshipLabels: Record<string, string> = { internal: 'Internal', external: 'External' };

async function RoleBadge({ role }: { role: 'admin' | 'commenter' }) {
    const { t } = await getAppI18n();
    return <Badge variant={role === 'admin' ? 'default' : 'secondary'}>{role === 'admin' ? t("Admin") : t("Commenter")}</Badge>;
}

/** A titled list of a page (people, invitations) */
function ListSection({ id, title, count, description, children }: {
    id: string;
    title: string;
    count: number;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
                <h2 id={`${id}-title`} className="m-0 flex items-center gap-2 text-base leading-6 font-semibold tracking-[-0.01em]">
                    {title}
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>
                </h2>
                <p className="m-0 text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
        </section>
    );
}

/** More people and invitations than this together, and the list shows its filters */
const FILTER_FROM = 8;

async function UsersPageContent({ searchParams }: PageProps<'/app/workspace/users'>) {
    const { t } = await getAppI18n();
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID) redirect(KnownPages.AppProjects);
    const { project: projectParam, relationship, team, state } = await searchParams;
    const [members, invitations, projects, access] = await Promise.all([
        listMembersWithUsers(context.workspace.id),
        listInvitations(context.workspace.id),
        listProjects(context.workspace.id), loadWorkspaceAccess(context.workspace.id)
    ]);
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    const project = typeof projectParam === 'string' && projectNames.has(projectParam) ? projectParam : undefined;

    const matches = (subject: import('@/src/lib/app/access').AccessSubject & { relationship?: string }) =>
        (!project || hasProjectAccess(access, subject, { id: project, workspaceId: context.workspace.id }))
        && (typeof relationship !== 'string' || relationship === 'all' || (subject.relationship ?? 'unspecified') === relationship)
        && (typeof team !== 'string' || team === 'all' || subject.teamIds?.includes(team));
    // Filters help once the list is long, and only those that tell people apart: a short list is read at a glance.
    // A filter that is set stays, so it can be cleared.
    const set = (value: unknown) => typeof value === 'string' && value !== 'all';
    const relationships = new Set([...members.map(({ member }) => member.relationship), ...invitations.map(invitation => invitation.relationship)]
        .map(value => value ?? 'unspecified'));
    const long = members.length + invitations.length > FILTER_FROM;
    const filters = ([
        ['project', projects.length > 1, project],
        ['relationship', relationships.size > 1, relationship],
        ['team', access.teams.length > 0, team],
        ['state', members.length > 0 && invitations.length > 0, state]
    ] as const).filter(([, useful, value]) => set(value) || (long && useful)).map(([filter]) => filter);
    const shownMembers = state === 'pending' ? [] : members.filter(({ member }) => matches(member));
    const shownInvitations = state === 'accepted' ? [] : invitations.filter(matches);
    const data = { access, projects, people: members.filter(person => person.user).map(({ member, name }) => ({ member, name })), revision: context.workspace.accessRevision ?? 0 };
    const teamChips = (ids: string[] = []) => <div className="flex flex-wrap gap-1">{access.teams.filter(team => ids.includes(team.id)).map(team => <Badge key={team.id} variant="outline"><Link href={KnownPageLinks.team(team.id)}>{team.name}</Link></Badge>)}</div>;

    return (
        <>
            <WorkspaceTabHeader
                description={t("The people who review the projects in this workspace.")}
                actions={(
                    <>
                        {/* Adding existing people to teams (or removing them) is occasional: a dialog, not the top of the page */}
                        {access.teams.length > 0 && (
                            <Dialog>
                                <DialogTrigger render={<Button variant="outline" />}>{t("Team membership")}</DialogTrigger>
                                <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
                                    <DialogHeader>
                                        <DialogTitle>{t("Team membership")}</DialogTitle>
                                        <DialogDescription>{t("Add or remove existing people without another invitation. Direct grants stay.")}</DialogDescription>
                                    </DialogHeader>
                                    <BulkTeamForm data={data} />
                                </DialogContent>
                            </Dialog>
                        )}
                        <InviteButton projectId={project} />
                    </>
                )}>
                {filters.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                        {filters.includes('project') && <ProjectFilter projects={projects.map(({ id, name }) => ({ id, name }))} value={project} />}
                        <UsersFilters teams={access.teams.map(({ id, name }) => ({ id, name }))} show={filters.filter(filter => filter !== 'project')} />
                    </div>
                )}
            </WorkspaceTabHeader>
            <div className="flex flex-col gap-10">
                <ListSection
                    id="members"
                    title={t("People")}
                    count={shownMembers.length}
                    description={project ? t("Who can review {value0}.", { value0: projectNames.get(project) }) : t("Admins and commenters of this workspace.")}>
                    <Card className="@container gap-0 py-0">
                        <ItemGroup aria-label={t("People")} className={columnsGroup}>
                            {shownMembers.map(({ member, name, avatarUrl }) => (
                                <Item key={member.id} role="listitem" className={columnsRow}>
                                    <ItemMedia className={centeredMedia}>
                                        <PersonAvatar name={name} avatarUrl={avatarUrl} aria-hidden="true" />
                                    </ItemMedia>
                                    <ItemContent className="min-w-48">
                                        <ItemTitle>
                                            <Link href={KnownPageLinks.member(member.userId)} className="underline-offset-4 hover:underline">{name}</Link>
                                            {member.userId === context.user.id && <span className="font-normal text-muted-foreground">{t("(you)")}</span>}
                                        </ItemTitle>
                                        <ItemDescription className="truncate font-mono text-[13px]">{member.email}</ItemDescription>
                                    </ItemContent>
                                    {/* What they can review, their teams, and since when */}
                                    <ItemContent className="min-w-0 basis-56">
                                        <Access role={member.role} projects={member.projects} names={projectNames} />
                                        {teamChips(member.teamIds)}
                                        <ItemDescription className="text-xs">
                                            {member.relationship && relationshipLabels[member.relationship] && `${relationshipLabels[member.relationship]} · `}{t("Joined")}{' '}<RelativeTime value={member.createdAt} />
                                        </ItemDescription>
                                    </ItemContent>
                                    <ItemActions className="ml-auto @2xl:ml-0">
                                        <span className={roleColumn}><RoleBadge role={member.role} /></span>
                                        <Link href={KnownPageLinks.member(member.userId)} aria-label={t("Manage access for {value0}", { value0: name })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t("Manage access")}</Link>
                                        {member.userId !== context.user.id && <RemoveMemberButton userId={member.userId} name={name} />}
                                    </ItemActions>
                                </Item>
                            ))}
                        </ItemGroup>
                    </Card>
                </ListSection>
                <ListSection
                    id="invitations"
                    title={t("Invitations")}
                    count={shownInvitations.length}
                    description={t("Sent and not accepted yet.")}>
                    {shownInvitations.length ? (
                        <Card className="@container gap-0 py-0">
                            <ItemGroup aria-label={t("Invitations")} className={columnsGroup}>
                                {shownInvitations.map(invitation => (
                                    <Item key={invitation.id} role="listitem" className={columnsRow}>
                                        <ItemMedia variant="icon" className={cn(centeredMedia, 'size-8 rounded-full border border-dashed')}>
                                            <MailIcon aria-hidden="true" className="text-muted-foreground" />
                                        </ItemMedia>
                                        <ItemContent className="min-w-48">
                                            <ItemTitle className="font-mono text-[13px] font-normal">{invitation.email}</ItemTitle>
                                            <ItemDescription className="text-xs"><span>{t("Expires")}{' '}<RelativeTime value={invitation.expiresAt} /></span></ItemDescription>
                                        </ItemContent>
                                        <ItemContent className="min-w-0 basis-56">
                                            <Access role={invitation.role} projects={invitation.projects} names={projectNames} />
                                            {teamChips(invitation.teamIds)}
                                            {invitation.relationship && relationshipLabels[invitation.relationship] && (
                                                <ItemDescription className="text-xs">{relationshipLabels[invitation.relationship]}</ItemDescription>
                                            )}
                                        </ItemContent>
                                        <ItemActions className="ml-auto @2xl:ml-0">
                                            <span className={roleColumn}><RoleBadge role={invitation.role} /></span>
                                            <ResendInvitationButton invitationId={invitation.id} email={invitation.email} />
                                            <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                                        </ItemActions>
                                    </Item>
                                ))}
                            </ItemGroup>
                        </Card>
                    ) : (
                        <p className="m-0 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("No pending invitations.")}</p>
                    )}
                </ListSection>
            </div>
        </>
    );
}

export default function UsersPage(props: Parameters<typeof UsersPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading users" />}><UsersPageContent {...props} /></Suspense>;
}
