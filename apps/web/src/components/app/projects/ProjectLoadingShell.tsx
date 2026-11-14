'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { ProjectTabs } from './ProjectTabs';

/**
 * The project's tabs while its layout loads (uier #439): the same `ProjectTabs`, working links, with the tabs every
 * project has (Comments, Page checks and Settings). The Install tab depends on the project (until its first comment),
 * so it appears with the loaded layout. The project comes from the address, which the router already has on a
 * navigation, so nothing waits for the server.
 */
export function ProjectLoadingTabs() {
    const { projectId } = useParams<{ projectId: string }>();
    return <ProjectTabs projectId={projectId} install={false} />;
}

/** The loading state of the project page being opened, by its address: the comments, the page checks, or another page */
export function ProjectLoadingPage({ comments, pageChecks, other }: { comments: ReactNode; pageChecks: ReactNode; other: ReactNode }) {
    const { projectId } = useParams<{ projectId: string }>();
    const pathname = usePathname();
    if (pathname === KnownPageLinks.project(projectId)) return comments;
    if (pathname === KnownPageLinks.projectPageChecks(projectId)) return pageChecks;
    return other;
}
