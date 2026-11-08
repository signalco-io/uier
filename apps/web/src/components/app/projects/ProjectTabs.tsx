'use client';

import { usePathname } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { LinkTabs } from '../LinkTabs';

/** Whether the page is the install guide: Settings → Installation, or the onboarding's install steps */
export function isInstallPage(pathname: string, projectId: string) {
    return pathname === KnownPageLinks.projectInstall(projectId) || pathname === `${KnownPageLinks.project(projectId)}/install`;
}

/**
 * A project's pages under its header: the comments and, until the site sends its first comment, the
 * install guide (Settings → Installation, and the onboarding's install step). With only the comments
 * left there is nothing to switch between, so there are no tabs. Settings is the cog in the header
 * (`ProjectSettingsButton`).
 */
export function ProjectTabs({ projectId, install }: { projectId: string; install: boolean }) {
    const pathname = usePathname();
    if (!install)
        return null;
    const comments = KnownPageLinks.project(projectId);
    return (
        <LinkTabs
            label="Project"
            tabs={[
                { href: comments, label: 'Comments', current: pathname === comments },
                { href: KnownPageLinks.projectInstall(projectId), label: 'Install', current: isInstallPage(pathname, projectId) }
            ]} />
    );
}
