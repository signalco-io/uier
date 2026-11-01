import type { Metadata } from 'next';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { notificationPreference } from '@/src/lib/notifications/preferences';
import { Section } from '@/src/components/app/PageHeader';
import { ProjectEmailExcerptsForm, ProjectEmailsButton } from '@/src/components/app/projects/ProjectSettingsForms';
import { projectSettingsContext } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Notifications · Project settings'
};

/** Everyone mutes or unmutes their own project emails; admins choose whether they carry comment excerpts */
export default async function ProjectNotificationSettingsPage({ params }: PageProps<'/app/projects/[projectId]/settings/notifications'>) {
    const { projectId } = await params;
    const { context, project, canConfigure } = await projectSettingsContext(projectId);
    const notifications = await notificationPreference(project.id, `user:${context.user.id}`);
    const muted = notifications?.muted ?? false;

    return (
        <Section
            id="emails"
            title="Email notifications"
            actions={<ProjectEmailsButton projectId={project.id} muted={muted} />}>
            {canConfigure
                ? <ProjectEmailExcerptsForm projectId={project.id} enabled={project.emailCommentExcerpts === true} />
                : <p className="m-0 text-sm text-muted-foreground">Comment excerpts are {project.emailCommentExcerpts ? 'on' : 'off'}. When on, short comment excerpts go to every recipient, verified guests included. {project.workspaceId === PUBLIC_WORKSPACE_ID ? 'The public feedback project settings are fixed.' : 'Only workspace admins can change this.'}</p>}
        </Section>
    );
}
