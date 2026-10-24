import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPages } from '@/src/knownPages';
import { getInvitation } from '@/src/lib/app/invitations';
import { getProject } from '@/src/lib/app/projects';
import { getUser } from '@/src/lib/app/users';
import { AcceptInvitationForm } from './AcceptInvitationForm';

export const metadata: Metadata = {
    title: 'Invitation'
};

export default async function InvitationPage({ searchParams }: PageProps<'/app/invitation'>) {
    const { token } = await searchParams;
    const pending = await getInvitation(token);

    if (!pending || typeof token !== 'string') {
        return (
            <div className="flex flex-col gap-4">
                <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">This invitation has expired</h1>
                <p className="m-0 text-sm text-muted-foreground">
                    Invitation links work once and expire after 7 days. Ask the person who invited you for a new one.
                </p>
                <Button href={KnownPages.AppSignIn} variant="outlined" size="lg" className="self-start">Sign in</Button>
            </div>
        );
    }

    const { invitation } = pending;
    const [inviter, project] = await Promise.all([
        getUser(invitation.invitedBy),
        invitation.projectId ? getProject(invitation.workspaceId, invitation.projectId) : null
    ]);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
                <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">
                    {project ? `Review ${project.name}` : 'You are invited'}
                </h1>
                <p className="m-0 text-sm text-muted-foreground">
                    {inviter ? <span className="font-medium text-foreground">{inviter.name}</span> : 'Someone'} invited you
                    {invitation.role === 'admin' ? ' as an admin' : ' to comment'}. Accepting signs you in
                    as <span className="font-medium text-foreground">{invitation.email}</span>
                    {project ? ' and opens the site with the toolbar.' : '.'}
                </p>
            </div>
            <AcceptInvitationForm token={token} />
        </div>
    );
}
