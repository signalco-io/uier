import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { getInvitation } from '@/src/lib/app/invitations';
import { getTeam } from '@/src/lib/app/teams';
import { listProjects } from '@/src/lib/app/projects';
import { getProject } from '@/src/lib/app/projects';
import { getUser } from '@/src/lib/app/users';
import { AuthCard } from '@/src/components/app/AuthCard';
import { appLinkMetadata, invitationLink } from '@/src/lib/metadata';
import { AcceptInvitationForm } from './AcceptInvitationForm';

// The preview never names the workspace, project or inviter: it is fetched without the person
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return {
    title: t('Invitation'),
    ...appLinkMetadata(invitationLink)
};
}

async function InvitationPageContent({ searchParams }: PageProps<'/app/invitation'>) {
    const { t } = await getAppI18n();
    const { token } = await searchParams;
    const pending = await getInvitation(token);

    if (!pending || typeof token !== 'string') {
        return (
            <AuthCard
                title={t("This invitation has expired")}
                description={t("Invitation links work once and expire after 7 days. Access may also have changed. Ask the person who invited you for a new one.")}>
                <Link href={KnownPages.AppSignIn} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>{t("Sign in")}</Link>
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
            title={project ? t("Review {value1}", { value1: project.name }) : t("You are invited")}
            description={(
                <>
                    {inviter ? <span className="font-medium text-foreground">{inviter.name}</span> : t("Someone")} {t("invited you")}{' '}{invitation.role === 'admin' ? t(" as an admin") : t(" to comment")}{t(". Accepting signs you in as")}{' '}<span className="font-medium text-foreground">{invitation.email}</span>
                    {project ? t(" and opens the site with the toolbar.") : '.'}
                </>
            )}>
            <div className="mb-4 text-sm text-muted-foreground">
                <p>{t("Current project access:")}{' '}{visibleProjects.map(project => project.name).join(', ') || 'No projects yet'}</p>
                {selectedTeams.length > 0 && <p>{t("Teams:")}{' '}{selectedTeams.map(team => team!.doc.name).join(', ')}{t(". Team access follows their current selected projects, including later admin changes. Team and direct grants add together.")}</p>}
            </div>
            <AcceptInvitationForm token={token} />
        </AuthCard>
    );
}

export default function InvitationPage(props: Parameters<typeof InvitationPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading invitation" />}><InvitationPageContent {...props} /></Suspense>;
}
