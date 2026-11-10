import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { configuredEnvironments } from '@/src/lib/app/environments';
import { listPageChecks } from '@/src/lib/pageChecks/store';
import { pageCheckRow } from '@/src/lib/pageChecks/model';
import { PageChecksView } from '@/src/components/app/pageChecks/PageChecksView';

export const metadata: Metadata = {
    title: 'Page checks'
};

/**
 * The project's Page checks: what the toolbar's background checks found on each page its members
 * reviewed (apps/web/docs/page-checks.md). Members of the project only, like its comments.
 */
export default async function ProjectPageChecksPage({ params }: PageProps<'/app/projects/[projectId]/page-checks'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const pages = await listPageChecks(project.id);
    return (
        <PageChecksView projectId={project.id} pages={pages.map(pageCheckRow)}
            environments={configuredEnvironments(project).map(({ origin, label }) => ({ origin, label }))} />
    );
}
