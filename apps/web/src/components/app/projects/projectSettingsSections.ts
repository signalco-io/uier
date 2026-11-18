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

/**
 * The fixed titles of the settings' cards, in source phrases: each section and its loading state
 * (`ProjectSettingsLoading`) read them here, so a skeleton never names a card differently from the page.
 */
export const projectSettingsTitles = {
    general: 'General',
    usage: 'Usage',
    review: 'Review',
    labels: 'Labels',
    addresses: 'Site addresses',
    people: 'People and teams',
    teams: 'Teams',
    peopleWithAccess: 'People with access',
    emails: 'Email notifications',
    emailContent: 'Email content',
    availableIntegrations: 'Available integrations',
    availableIntegrationsDescription: 'Copy shared feedback to the tools your team works in. Private feedback is never sent.',
    allIntegrations: 'All integrations',
    integrationFeatures: 'What it does',
    dangerZone: 'Danger zone',
    markAsDone: 'Mark as done',
    reopenProject: 'Reopen project',
    transferProject: 'Transfer project',
    deleteProject: 'Delete project'
} as const;
