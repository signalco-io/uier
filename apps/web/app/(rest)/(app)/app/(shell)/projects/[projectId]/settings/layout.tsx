
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { KnownPageLinks } from '@/src/knownPages';
import { SettingsLayout, settingsTabs } from '@/src/components/app/SettingsLayout';
import { projectSettingsSections } from '@/src/components/app/projects/projectSettingsSections';
import { projectSettingsContext } from './settingsContext';

export const metadata: Metadata = {
    referrer: 'same-origin'
};

/**
 * A project's settings: the sections beside the chosen one (above it on small screens). Everyone sets
 * their own project emails and sees the install guide; admins also set up the project.
 */
async function ProjectSettingsLayoutContent({ children, params }: LayoutProps<'/app/projects/[projectId]/settings'>) {
    const { t } = await getAppI18n();
    const { projectId } = await params;
    const { project, canConfigure } = await projectSettingsContext(projectId);
    const sections = projectSettingsSections.filter(section => canConfigure || !section.configure);

    return (
        <SettingsLayout tabs={settingsTabs(sections, section => KnownPageLinks.projectSettings(project.id, section))} label={t("Project settings")} heading={t("Settings")}>
            {children}
        </SettingsLayout>
    );
}

export default function ProjectSettingsLayout(props: Parameters<typeof ProjectSettingsLayoutContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading settings" />}><ProjectSettingsLayoutContent {...props} /></Suspense>;
}
