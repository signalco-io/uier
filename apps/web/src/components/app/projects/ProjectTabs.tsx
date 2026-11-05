'use client';

import { usePathname } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { LinkTabs } from '../LinkTabs';

/**
 * A project's pages under its header: the comments, the install guide (Settings → Installation, and the
 * onboarding's install step) and the settings (every other section)
 */
export function ProjectTabs({ projectId }: { projectId: string }) {
    const pathname = usePathname();
    const comments = KnownPageLinks.project(projectId);
    const install = KnownPageLinks.projectInstall(projectId);
    const settings = KnownPageLinks.projectSettings(projectId);
    const installCurrent = pathname === install || pathname === `${comments}/install`;
    const settingsCurrent = !installCurrent && (pathname === settings || pathname.startsWith(`${settings}/`));
    return (
        <LinkTabs
            label="Project"
            tabs={[
                { href: comments, label: 'Comments', current: pathname === comments },
                { href: install, label: 'Install', current: installCurrent },
                { href: settings, label: 'Settings', current: settingsCurrent }
            ]} />
    );
}
