import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { getInvitation } from '@/src/lib/app/invitations';
import { getTeam } from '@/src/lib/app/teams';
import { listProjects } from '@/src/lib/app/projects';
import { getProject } from '@/src/lib/app/projects';
import { getUser } from '@/src/lib/app/users';
import { AuthCard } from '@/src/components/app/AuthCard';
import { AcceptInvitationForm } from './AcceptInvitationForm';

export const metadata: Metadata = {
    title: 'Invitation'
};

export default async function InvitationPage({ searchParams }: PageProps<'/app/invitation'>) {
    const { token } = await searchParams;
    const pending = await getInvitation(token);

    if (!pending || typeof token !== 'string') {
        return (
            <AuthCard
                title="This invitation has expired"
                description="Invitation links work once and expire after 7 days. Access may also have changed. Ask the person who invited you for a new one.">
                <Button variant="outline" size="lg" className="w-full" asChild>
                    <Link href={KnownPages.AppSignIn}>Sign in</Link>
                </Button>
            </AuthCard>
        );
    }

    const { invitation } = pending;
    const [inviter, project] = await Promise.all([
        getUser(invitation.invitedBy),
        invitation.projectId ? getProject(invitation.workspaceId, invitation.projectId) : null
    ]);

    const selectedTeams = (await Promise.all((invitation.teamIds ?? []).map(id => getTeam(invitation.workspaceId, id)))).filter(Boolean);
    const projects = await listProjects(invitation.workspaceId);
    const visibleProjects = invitation.role === 'admin' || invitation.projects === 'all' ? projects : projects.filter(project => (invitation.projects as string[]).includes(project.id) || selectedTeams.some(team => team!.doc.projectIds.includes(project.id)));

    return (
        <AuthCard
            title={project ? `Review ${project.name}` : 'You are invited'}
            description={(
                <>
                    {inviter ? <span className="font-medium text-foreground">{inviter.name}</span> : 'Someone'} invited you
                    {invitation.role === 'admin' ? ' as an admin' : ' to comment'}. Accepting signs you in
                    as <span className="font-medium text-foreground">{invitation.email}</span>
                    {project ? ' and opens the site with the toolbar.' : '.'}
                </>
            )}>
            <div className="mb-4 text-sm text-muted-foreground">
                <p>Current project access: {visibleProjects.map(project => project.name).join(', ') || 'No projects yet'}</p>
                {selectedTeams.length > 0 && <p>Teams: {selectedTeams.map(team => team!.doc.name).join(', ')}. Team access follows their current selected projects, including later admin changes. Team and direct grants add together.</p>}
            </div>
            <AcceptInvitationForm token={token} />
        </AuthCard>
    );
}
