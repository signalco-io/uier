import { KnownPages } from '@/src/knownPages';

/**
 * What decides the workspace area's tabs: whether the person is an admin, and whether this is uier's own workspace
 * (`PUBLIC_WORKSPACE_ID`). The shell holds both (`useShellInfo().workspace`), so the tabs need no read of their own;
 * a page passes them from its context.
 */
export type WorkspaceRole = { admin: boolean; feedback: boolean };

/** Whether the person manages the workspace's people and teams: its admins, except in uier's own workspace */
export function managesWorkspace({ admin, feedback }: WorkspaceRole) {
    return admin && !feedback;
}

/**
 * The tabs of the workspace area. Its admins manage the people, teams and settings and see who changed
 * access (Activity); everyone sees the clients and the usage of the projects they can review. uier's own
 * workspace exposes label settings to staff but keeps people management restricted.
 */
export function workspaceTabs(role: WorkspaceRole) {
    const manages = managesWorkspace(role);
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
        ...role.admin ? [{ href: KnownPages.AppSettings, label: 'Settings' }] : []
    ];
}
