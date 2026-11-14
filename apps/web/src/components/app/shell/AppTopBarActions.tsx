'use client';

import { usePathname } from 'next/navigation';
import { ReviewLinksMenu } from '../projects/ReviewLinksMenu';

/** A project the top bar can open for review: its addresses, the main site first */
export type TopBarProject = { urls: string[] };

/**
 * The top bar's actions, at its right end beside the breadcrumbs (uier #406): on a project's pages, Open review
 * (Review and Visit site for each address, then Review setup), outlined, not primary, so it does not draw the eye
 * (uier #412). Read from the path, like the breadcrumbs, so it is there while the project's page loads.
 */
export function AppTopBarActions({ projects }: { projects: Record<string, TopBarProject> }) {
    const [, , section, id] = usePathname().split('/');
    const project = section === 'projects' && id ? projects[id] : undefined;
    if (!project || !id)
        return null;
    return (
        <div className="ml-auto flex shrink-0 items-center gap-2">
            <ReviewLinksMenu projectId={id} urls={project.urls} size="sm" visit />
        </div>
    );
}
