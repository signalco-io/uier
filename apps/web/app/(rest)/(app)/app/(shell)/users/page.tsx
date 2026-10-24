import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { Add } from '@signalco/ui-icons';
import { KnownPages } from '@/src/knownPages';
import { requireAdminContext } from '@/src/lib/app/context';
import { listMembersWithUsers } from '@/src/lib/app/members';
import { listInvitations } from '@/src/lib/app/invitations';
import { listProjects } from '@/src/lib/app/projects';
import { memberCanAccessProject } from '@/src/lib/app/workspaces';
import type { ProjectsAccess } from '@/src/lib/app/model';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { DateTime } from '@/src/components/app/comments/DateTime';
import { ProjectFilter } from '@/src/components/app/users/ProjectFilter';
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
                actions={(
                    <Button href={`${KnownPages.AppInviteUser}${project ? `?project=${project}` : ''}`} variant="solid" startDecorator={<Add className="size-4" />}>
                        Invite
                    </Button>
                )}>
                <ProjectFilter projects={projects.map(({ id, name }) => ({ id, name }))} value={project} />
            </PageHeader>
            <div className="flex flex-col gap-6">
                <Section id="members" title="People" description={project ? `Who can review ${projectNames.get(project)}.` : 'Admins and commenters of this workspace.'}>
                    <ul aria-label="People" className="m-0 flex list-none flex-col divide-y rounded-xl border p-0">
                        {shownMembers.map(({ member, name }) => (
                            <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                                <div className="flex min-w-0 flex-1 basis-56 flex-col">
                                    <span className="truncate font-medium">
                                        {name}
                                        {member.userId === context.user.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                                    </span>
                                    <span className="truncate font-mono text-[13px] text-muted-foreground">{member.email}</span>
                                </div>
                                <span className="w-24 text-sm">{member.role === 'admin' ? 'Admin' : 'Commenter'}</span>
                                <span className="min-w-0 flex-1 basis-40 truncate text-sm text-muted-foreground">
                                    {accessText(member.role, member.projects, projectNames)}
                                </span>
                                <span className="text-sm text-muted-foreground">Joined <DateTime value={member.createdAt} /></span>
                                <div className="ml-auto w-20 text-right">
                                    {member.userId !== context.user.id && <RemoveMemberButton userId={member.userId} name={name} />}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Section>
                <Section id="invitations" title="Invitations" description="Sent and not accepted yet. A link works once and expires after 7 days.">
                    {shownInvitations.length ? (
                        <ul aria-label="Invitations" className="m-0 flex list-none flex-col divide-y rounded-xl border p-0">
                            {shownInvitations.map(invitation => (
                                <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                                    <span className="min-w-0 flex-1 basis-56 truncate font-mono text-[13px]">{invitation.email}</span>
                                    <span className="w-24 text-sm">{invitation.role === 'admin' ? 'Admin' : 'Commenter'}</span>
                                    <span className="min-w-0 flex-1 basis-40 truncate text-sm text-muted-foreground">
                                        {accessText(invitation.role, invitation.projects, projectNames)}
                                    </span>
                                    <span className="text-sm text-muted-foreground">Expires <DateTime value={invitation.expiresAt} /></span>
                                    <div className="ml-auto w-20 text-right">
                                        <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="m-0 text-sm text-muted-foreground">No pending invitations.</p>
                    )}
                </Section>
            </div>
        </>
    );
}
