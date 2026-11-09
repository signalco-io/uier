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
    { section: 'coding-agents', label: 'Coding agents' }
];
