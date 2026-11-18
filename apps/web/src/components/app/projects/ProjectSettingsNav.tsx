'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPageLinks } from '@/src/knownPages';
import { SettingsLayout, settingsTabs } from '../SettingsLayout';
import { canConfigureProjects, useShellInfo } from '../shell/ShellInfo';
import { projectSettingsSections } from './projectSettingsSections';

/**
 * A project's settings: the section links beside the chosen section (above it on small screens). The links depend
 * only on the person's role, which the shell already knows (`useShellInfo`), and the project comes from the address,
 * so they need no read of their own: they are there the moment Settings opens, mounted once, and a focused link
 * keeps the focus while its section loads (docs/design/loading-states, 11 and 12). Everyone sets their own project
 * emails and sees the install guide; those who configure the project see every section, and an admin of uier's own
 * workspace its labels (Review). Links only: every section authorizes itself (`settingsContext.ts`).
 */
export function ProjectSettingsNav({ children }: { children: ReactNode }) {
    const { t } = useAppI18n();
    const { projectId } = useParams<{ projectId: string }>();
    const info = useShellInfo();
    const canConfigure = canConfigureProjects(info);
    const admin = info?.workspace.admin === true;
    const sections = projectSettingsSections
        .filter(section => canConfigure || !section.configure || (admin && section.section === 'review'))
        .map(section => ({ ...section, label: t(section.label) }));

    return (
        <SettingsLayout tabs={settingsTabs(sections, section => KnownPageLinks.projectSettings(projectId, section))} label={t("Project settings")} heading={t("Settings")}>
            {children}
        </SettingsLayout>
    );
}
