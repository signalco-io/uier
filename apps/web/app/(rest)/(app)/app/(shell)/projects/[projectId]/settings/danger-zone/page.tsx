import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { DeleteProjectButton, ProjectStatusButton, TransferProjectButton } from '@/src/components/app/projects/ProjectDangerZone';
import { projectTransferPreview, projectTransferTargets } from '@/src/lib/app/projectTransfer';
import { configurableProject } from '../settingsContext';

export const metadata: Metadata = {
    title: 'Danger zone · Project settings'
};

/** Changes to the whole project, each a row with its button */
async function ProjectDangerZonePageContent({ params }: PageProps<'/app/projects/[projectId]/settings/danger-zone'>) {
    const { projectId } = await params;
    const { context, project } = await configurableProject(projectId);
    const targets = projectTransferTargets(context);
    const preview = targets.length ? await projectTransferPreview(project, context.user.id) : null;

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
                        <h3 className="m-0 text-sm font-medium">Transfer project</h3>
                        <p className="m-0 text-sm text-muted-foreground">
                            {preview
                                ? 'Moves the project with its comments and settings to another workspace where you are an admin. Connected services and access given here stay behind.'
                                : 'Moves the project to another workspace where you are an admin. You are not an admin of another workspace yet.'}
                        </p>
                    </div>
                    <TransferProjectButton projectId={project.id} name={project.name} targets={targets}
                        preview={preview ?? { integrations: [], people: 0, teams: 0, invitations: 0 }} />
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

export default function ProjectDangerZonePage(props: Parameters<typeof ProjectDangerZonePageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading danger zone" />}><ProjectDangerZonePageContent {...props} /></Suspense>;
}
