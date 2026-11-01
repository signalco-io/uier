import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { DeleteProjectButton, ProjectStatusButton } from '@/src/components/app/projects/ProjectSettingsForms';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Danger zone · Project settings'
};

/** Changes to the whole project, each a row with its button */
export default async function ProjectDangerZonePage({ params }: PageProps<'/app/projects/[projectId]/settings/danger-zone'>) {
    const { projectId } = await params;
    const { project } = await configurableProject(projectId);

    return (
        <Section id="danger-zone" title="Danger zone" className="border-destructive/40">
            <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <h3 className="m-0 text-sm font-medium">{project.status === 'done' ? 'Reopen project' : 'Mark as done'}</h3>
                        <p className="m-0 text-sm text-muted-foreground">
                            {project.status === 'done'
                                ? 'This project is done. Reopen it to move it back to the active projects.'
                                : 'Mark the project as done when the review is over. It moves to the done projects; nothing is deleted.'}
                        </p>
                    </div>
                    <ProjectStatusButton projectId={project.id} status={project.status} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <h3 className="m-0 text-sm font-medium">Delete project</h3>
                        <p className="m-0 text-sm text-muted-foreground">
                            Deletes the project with its comments, screenshots, review links and integration settings. This can't be undone.
                        </p>
                    </div>
                    <DeleteProjectButton projectId={project.id} name={project.name} />
                </div>
            </div>
        </Section>
    );
}
