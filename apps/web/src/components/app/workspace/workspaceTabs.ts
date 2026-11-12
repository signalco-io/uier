import { KnownPages } from '@/src/knownPages';
import type { AppContext } from '@/src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';

/**
 * The tabs of the workspace area. Its admins manage the people, teams and settings and see who changed
 * access (Activity); everyone sees the clients and the usage of the projects they can review. uier's own
 * workspace exposes label settings to staff but keeps people management restricted.
 */
export function workspaceTabs(context: AppContext) {
    const manages = context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID;
    return [
        ...manages ? [
            { href: KnownPages.AppUsers, label: 'Users' },
            { href: KnownPages.AppTeams, label: 'Teams' }
        ] : [],
        { href: KnownPages.AppClients, label: 'Clients' },
        { href: KnownPages.AppWorkspaceUsage, label: 'Usage' },
        ...manages ? [
            { href: KnownPages.AppActivity, label: 'Activity' }
        ] : [],
        ...context.isAdmin ? [{ href: KnownPages.AppSettings, label: 'Settings' }] : []
    ];
}
