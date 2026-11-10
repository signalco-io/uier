'use client';

import { usePathname } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { LinkTabs } from '../LinkTabs';

/** Whether the page is the install guide: Settings → Installation, or the onboarding's install steps */
export function isInstallPage(pathname: string, projectId: string) {
    return pathname === KnownPageLinks.projectInstall(projectId) || pathname === `${KnownPageLinks.project(projectId)}/install`;
}

/**
 * A project's pages under its header: the comments, the page checks (what the toolbar's checks found on
 * each page members reviewed) and, until the site sends its first comment, the install guide (Settings →
 * Installation, and the onboarding's install step). Settings is the cog in the header
 * (`ProjectSettingsButton`).
 */
export function ProjectTabs({ projectId, install }: { projectId: string; install: boolean }) {
    const pathname = usePathname();
    const comments = KnownPageLinks.project(projectId);
    const pageChecks = KnownPageLinks.projectPageChecks(projectId);
    return (
        <LinkTabs
            label="Project"
            tabs={[
                { href: comments, label: 'Comments', current: pathname === comments },
                { href: pageChecks, label: 'Page checks', current: pathname === pageChecks },
                ...install ? [{ href: KnownPageLinks.projectInstall(projectId), label: 'Install', current: isInstallPage(pathname, projectId) }] : []
            ]} />
    );
}
