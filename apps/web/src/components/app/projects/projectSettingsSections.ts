import type { ProjectSettingsSection } from '../../../knownPages';
import type { SettingsSection } from '../SettingsLayout';

/**
 * The sections of a project's settings, in the order of their navigation. General has no `section`
 * (it is the settings page itself); `configure` sections are only for those who set up the project.
 */
export const projectSettingsSections: (SettingsSection<ProjectSettingsSection> & { configure: boolean })[] = [
    { label: 'General', configure: true },
    { section: 'review', label: 'Review', configure: true },
    { section: 'environments', label: 'Environments', configure: true },
    { section: 'installation', label: 'Installation', configure: false },
    { section: 'people', label: 'People and teams', configure: true },
    { section: 'integrations', label: 'Integrations', configure: true },
    { section: 'notifications', label: 'Notifications', configure: false },
    { section: 'danger-zone', label: 'Danger zone', configure: true }
];
