import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { getInvitation } from '@/src/lib/app/invitations';
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
                description="Invitation links work once and expire after 7 days. Ask the person who invited you for a new one.">
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
            <AcceptInvitationForm token={token} />
        </AuthCard>
    );
}
