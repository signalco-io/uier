import type { AccountSection } from '../../../knownPages';
import type { SettingsSection } from '../SettingsLayout';

/**
 * The sections of the account, in the order of their navigation. General has no `section` (it is the
 * account page itself).
 */
export const accountSections: SettingsSection<AccountSection>[] = [
    { label: 'General' },
    { section: 'sign-in', label: 'Sign-in' },
    { section: 'notifications', label: 'Notifications' },
    { section: 'usage', label: 'Usage' },
    { section: 'coding-agents', label: 'Coding agents' },
    { section: 'api-tokens', label: 'API tokens' }
];

/**
 * The fixed titles of the account's cards, in source phrases: each section and its loading state
 * (`AccountLoading`) read them here, so a skeleton never names a card differently from the page.
 */
export const accountTitles = {
    profile: 'Profile',
    appLanguage: 'App language',
    appearance: 'Appearance',
    toolbarLanguage: 'Toolbar language',
    access: 'Your workspace access',
    google: 'Google account',
    microsoft: 'Microsoft account',
    passkeys: 'Passkeys',
    signOut: 'Sign out',
    projectEmails: 'Project emails',
    limits: 'Your limits',
    connectedApps: 'Connected apps',
    plugin: 'Install the uier plugin',
    connect: 'Connect a coding tool',
    accessTokens: 'Access tokens',
    skill: 'Prompts and agent skill'
} as const;
