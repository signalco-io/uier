import type { Metadata } from 'next';
import { FolderIcon, FoldersIcon, MailIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import { Card } from '@/src/components/ui/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { cn } from '@/src/lib/utils';
import { requireAdminContext } from '@/src/lib/app/context';
import { listMembersWithUsers } from '@/src/lib/app/members';
import { listInvitations } from '@/src/lib/app/invitations';
import { listProjects } from '@/src/lib/app/projects';
import { memberCanAccessProject } from '@/src/lib/app/workspaces';
import type { ProjectsAccess } from '@/src/lib/app/model';
import { PageHeader } from '@/src/components/app/PageHeader';
import { RelativeTime } from '@/src/components/app/comments/DateTime';
import { initials } from '@/src/components/app/initials';
import { ProjectFilter } from '@/src/components/app/users/ProjectFilter';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { RemoveMemberButton, RevokeInvitationButton } from '@/src/components/app/users/UserActions';

export const metadata: Metadata = {
    title: 'Users'
};

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

function RoleBadge({ role }: { role: 'admin' | 'commenter' }) {
    return <Badge variant={role === 'admin' ? 'default' : 'secondary'}>{role === 'admin' ? 'Admin' : 'Commenter'}</Badge>;
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

export default async function UsersPage({ searchParams }: PageProps<'/app/users'>) {
    const context = await requireAdminContext();
    const { project: projectParam } = await searchParams;
    const [members, invitations, projects] = await Promise.all([
        listMembersWithUsers(context.workspace.id),
        listInvitations(context.workspace.id),
        listProjects(context.workspace.id)
    ]);
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    const project = typeof projectParam === 'string' && projectNames.has(projectParam) ? projectParam : undefined;

    const shownMembers = project ? members.filter(({ member }) => memberCanAccessProject(member, project)) : members;
    const shownInvitations = project ? invitations.filter(invitation => memberCanAccessProject(invitation, project)) : invitations;

    return (
        <>
            <PageHeader
                title="Users"
                description="The people who review the projects in this workspace."
                actions={<InviteButton projectId={project} />}>
                <ProjectFilter projects={projects.map(({ id, name }) => ({ id, name }))} value={project} />
            </PageHeader>
            <div className="flex flex-col gap-10">
                <ListSection
                    id="members"
                    title="People"
                    count={shownMembers.length}
                    description={project ? `Who can review ${projectNames.get(project)}.` : 'Admins and commenters of this workspace.'}>
                    <Card className="gap-0 py-0">
                        <ItemGroup aria-label="People" className="gap-0 divide-y">
                            {shownMembers.map(({ member, name }) => (
                                <Item key={member.id} role="listitem" className="rounded-none">
                                    <ItemMedia className={centeredMedia}>
                                        <Avatar aria-hidden="true">
                                            <AvatarFallback>{initials(name)}</AvatarFallback>
                                        </Avatar>
                                    </ItemMedia>
                                    <ItemContent className="min-w-48">
                                        <ItemTitle>
                                            {name}
                                            {member.userId === context.user.id && <span className="font-normal text-muted-foreground">(you)</span>}
                                        </ItemTitle>
                                        <ItemDescription className="truncate font-mono text-[13px]">{member.email}</ItemDescription>
                                    </ItemContent>
                                    <ItemContent className="min-w-0 basis-48">
                                        <Access role={member.role} projects={member.projects} names={projectNames} />
                                        <ItemDescription className="text-xs"><span>Joined <RelativeTime value={member.createdAt} /></span></ItemDescription>
                                    </ItemContent>
                                    <ItemActions className="ml-auto">
                                        {member.userId !== context.user.id && <RemoveMemberButton userId={member.userId} name={name} />}
                                        <span className={roleColumn}><RoleBadge role={member.role} /></span>
                                    </ItemActions>
                                </Item>
                            ))}
                        </ItemGroup>
                    </Card>
                </ListSection>
                <ListSection
                    id="invitations"
                    title="Invitations"
                    count={shownInvitations.length}
                    description="Sent and not accepted yet.">
                    {shownInvitations.length ? (
                        <Card className="gap-0 py-0">
                            <ItemGroup aria-label="Invitations" className="gap-0 divide-y">
                                {shownInvitations.map(invitation => (
                                    <Item key={invitation.id} role="listitem" className="rounded-none">
                                        <ItemMedia variant="icon" className={cn(centeredMedia, 'size-8 rounded-full border border-dashed')}>
                                            <MailIcon aria-hidden="true" className="text-muted-foreground" />
                                        </ItemMedia>
                                        <ItemContent className="min-w-48">
                                            <ItemTitle className="font-mono text-[13px] font-normal">{invitation.email}</ItemTitle>
                                            <ItemDescription className="text-xs"><span>Expires <RelativeTime value={invitation.expiresAt} /></span></ItemDescription>
                                        </ItemContent>
                                        <ItemContent className="min-w-0 basis-48">
                                            <Access role={invitation.role} projects={invitation.projects} names={projectNames} />
                                        </ItemContent>
                                        <ItemActions className="ml-auto">
                                            <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                                            <span className={roleColumn}><RoleBadge role={invitation.role} /></span>
                                        </ItemActions>
                                    </Item>
                                ))}
                            </ItemGroup>
                        </Card>
                    ) : (
                        <p className="m-0 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No pending invitations.</p>
                    )}
                </ListSection>
            </div>
        </>
    );
}
