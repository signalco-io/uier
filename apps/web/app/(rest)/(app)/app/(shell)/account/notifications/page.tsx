import type { Metadata } from 'next';
import Link from 'next/link';
import { KnownPageLinks } from '@/src/knownPages';
import { Section } from '@/src/components/app/PageHeader';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ProjectEmailsSwitch } from '@/src/components/app/projects/ProjectSettingsForms';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { notificationPreference } from '@/src/lib/notifications/preferences';

export const metadata: Metadata = {
    title: 'Notifications · Account'
};

/** The person's emails from every project they can see in the selected workspace, each on or off */
export default async function AccountNotificationsPage() {
    const context = await requireAppContext();
    const projects = await listVisibleProjects(context);
    const preferences = await Promise.all(projects.map(project => notificationPreference(project.id, `user:${context.user.id}`)));

    return (
        <Section
            id="project-emails"
            title="Project emails"
            description={`Your emails from each project in ${context.workspace.name}. Off stops every email from that project, also for threads you follow.`}>
            {projects.length > 0
                ? (
                    <ul className="m-0 flex list-none flex-col divide-y p-0" aria-label="Projects">
                        {projects.map((project, index) => (
                            <li key={project.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                <ProjectMark name={project.name} url={project.urls[0]} />
                                <Link href={KnownPageLinks.projectSettings(project.id, 'notifications')} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline hover:underline-offset-4">
                                    {project.name}
                                </Link>
                                <ProjectEmailsSwitch projectId={project.id} muted={preferences[index]?.muted ?? false} ariaLabel={`Emails from ${project.name}`} />
                            </li>
                        ))}
                    </ul>
                )
                : <p className="m-0 text-sm text-muted-foreground">No projects here yet.</p>}
        </Section>
    );
}
