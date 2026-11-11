import type { Metadata } from 'next';
import Link from 'next/link';
import { KnownPageLinks } from '@/src/knownPages';
import { notificationPreference } from '@/src/lib/notifications/preferences';
import { Section } from '@/src/components/app/PageHeader';
import { ProjectEmailExcerptsSwitch } from '@/src/components/app/projects/ProjectEmailExcerptsSwitch';
import { ProjectEmailsSwitch } from '@/src/components/app/projects/ProjectEmailsSwitch';
import { projectSettingsContext } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Notifications · Project settings'
};

/** Everyone turns their own project emails on or off; admins also choose whether emails carry comment excerpts */
export default async function ProjectNotificationSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/notifications'>) {
    const { projectId } = await params;
    const { context, project, canConfigure } = await projectSettingsContext(projectId);
    const notifications = await notificationPreference(project.id, `user:${context.user.id}`);
    const muted = notifications?.muted ?? false;

    return (
        <>
            <Section
                id="emails"
                title="Email notifications"
                description={<>Off stops every email from this project, also for threads you follow. <Link href={KnownPageLinks.account('notifications')} className="underline underline-offset-4 hover:text-foreground">Manage all your projects</Link>.</>}>
                <div className="flex flex-col gap-3">
                    <ProjectEmailsSwitch projectId={project.id} muted={muted} label="Emails from this project" />
                    {/* The project's setting is the admins'; everyone else only learns what their emails carry */}
                    {!canConfigure && project.emailCommentExcerpts && <p className="m-0 text-sm text-muted-foreground">These emails include short comment excerpts.</p>}
                </div>
            </Section>
            {canConfigure && (
                <Section id="excerpts" title="Email content">
                    <ProjectEmailExcerptsSwitch projectId={project.id} enabled={project.emailCommentExcerpts === true} />
                </Section>
            )}
        </>
    );
}
