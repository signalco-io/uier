'use client';

import { projectIconSizes } from '@/src/lib/app/projectIconSizes';
import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { Bar, HeaderOutline } from '../loading/outlines';
import { PageHeader } from '../PageHeader';
import { useShellInfo } from '../shell/ShellInfo';
import { ProjectMark } from './ProjectMark';
import { isInstallPage, ProjectTabs } from './ProjectTabs';

/** The loaded header's width rule: as wide as the comments or the page checks under it (`data-header-wide`), else the reading width */
const headerClassName = 'min-w-0 pb-4 group-has-[[data-header-wide]]/project:page-wide';

/**
 * The project's header while its layout loads: its favicon and name at once, since the sidebar beside it already
 * shows them (`useShellInfo`), at the loaded header's size, so a long name wraps here as it will there. The line
 * under the name (the client, who can comment, links) is the project's own data: one bar. A project the shell does
 * not list (opened by its address from another workspace's page) is all outline until it loads.
 */
export function ProjectLoadingHeader() {
    const { projectId } = useParams<{ projectId: string }>();
    const project = useShellProject(projectId);
    if (!project) return <HeaderOutline media className={headerClassName} />;
    return (
        <PageHeader
            className={headerClassName}
            media={<ProjectMark name={project.name} projectId={projectId} url={project.url} iconSize={projectIconSizes.header} className="size-14 rounded-xl text-xl [&>img]:p-2.5" />}
            title={project.name}
            description={<span aria-hidden="true" className="flex h-5 items-center"><Bar className="h-4 w-36" /></span>} />
    );
}

/**
 * The project's tabs while its layout loads (uier #439): the same `ProjectTabs`, working links, with the tabs every
 * project has (Comments, Page checks and Settings). The Install tab depends on the project (it stays until the first
 * comment), so it appears with the loaded layout, except where the page being opened is the Install tab itself
 * (onboarding's steps, Settings → Installation) and the shell knows of no comment: there it is the current tab at
 * once. The project comes from the address, which the router already has on a navigation, so nothing waits for the
 * server.
 */
export function ProjectLoadingTabs() {
    const { projectId } = useParams<{ projectId: string }>();
    const pathname = usePathname();
    const project = useShellProject(projectId);
    const filesEnabled = !useShellInfo()?.workspace.feedback;
    const install = isInstallPage(pathname, projectId) && project?.open === 0 && !project.feedback;
    return <ProjectTabs projectId={project?.id ?? projectId} publicId={project?.publicId} hasSites={project ? Boolean(project.url) : undefined} filesEnabled={filesEnabled} install={install} />;
}

function useShellProject(projectId: string) {
    const projects = useShellInfo()?.projects;
    return projects?.[projectId] ?? Object.values(projects ?? {}).find(project => project.publicId === projectId);
}

/** The loading state of the project page being opened, by its address: the comments, the page checks, a settings section, or the install steps */
export function ProjectLoadingPage({ comments, files, pageChecks, settings, install }: { comments: ReactNode; files: ReactNode; pageChecks: ReactNode; settings: ReactNode; install: ReactNode }) {
    const { projectId } = useParams<{ projectId: string }>();
    const pathname = usePathname();
    if (pathname === KnownPageLinks.project(projectId)) return comments;
    if (pathname === KnownPageLinks.projectFiles(projectId)) return files;
    if (pathname === KnownPageLinks.projectPageChecks(projectId)) return pageChecks;
    const settingsPath = KnownPageLinks.projectSettings(projectId);
    if (pathname === settingsPath || pathname.startsWith(`${settingsPath}/`)) return settings;
    return install;
}
