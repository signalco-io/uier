import type { Metadata } from 'next';
import { KnownPageLinks } from '@/src/knownPages';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { projectSettingsSections } from '@/src/components/app/projects/projectSettingsSections';
import { projectSettingsContext } from './settingsContext';

export const metadata: Metadata = {
    referrer: 'same-origin'
};

/**
 * A project's settings: the sections beside the chosen one (above it on small screens). Everyone sets
 * their own project emails and sees the install guide; admins also set up the project.
 */
export default async function ProjectSettingsLayout({ children, params }: LayoutProps<'/app/projects/[projectId]/settings'>) {
    const { projectId } = await params;
    const { project, canConfigure } = await projectSettingsContext(projectId);
    const tabs = projectSettingsSections
        .filter(section => canConfigure || !section.configure)
        .map(({ section, label }) => ({ label, href: KnownPageLinks.projectSettings(project.id, section), nested: Boolean(section) }));

    return (
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
            <h2 className="sr-only">Settings</h2>
            <LinkTabs tabs={tabs} label="Project settings" variant="side" match="path" className="md:sticky md:top-6 md:w-44 md:shrink-0" />
            <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-6">
                {children}
            </div>
        </div>
    );
}
