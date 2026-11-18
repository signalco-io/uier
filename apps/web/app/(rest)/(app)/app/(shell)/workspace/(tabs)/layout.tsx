import type { PropsWithChildren } from 'react';
import { WorkspaceHeader } from '@/src/components/app/workspace/WorkspaceHeader';

/**
 * The workspace area: the workspace's name above its tabs (Users, Teams, Clients, Usage, Activity and
 * Settings for admins; Clients and Usage for everyone else). A team's and a person's own pages open from the tabs, without them.
 *
 * The header reads nothing here: the shell already knows the name and the role (`WorkspaceHeader`), so it needs no
 * boundary and stays mounted while a tab loads under it. Each tab's page authorizes itself.
 */
export default function WorkspaceTabsLayout({ children }: PropsWithChildren) {
    return (
        <>
            <WorkspaceHeader />
            {children}
        </>
    );
}
