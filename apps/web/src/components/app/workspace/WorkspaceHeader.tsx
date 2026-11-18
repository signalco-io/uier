'use client';

import { LinkTabs } from '../LinkTabs';
import { PageHeader } from '../PageHeader';
import { HeaderOutline } from '../loading/outlines';
import { useShellInfo } from '../shell/ShellInfo';
import { workspaceTabs } from './workspaceTabs';

/**
 * The workspace area's header: the workspace's name above its tabs. Both come from what the shell already knows
 * (`useShellInfo`: the name the sidebar shows, the role that decides the tabs), so the header is real the moment the
 * area opens and stays mounted, focus included, while a tab loads (docs/design/loading-states #16). It authorizes
 * nothing: each tab's page does. `LinkTabs` translates the labels.
 *
 * `entering`: on `/app/workspace`, which only redirects to the first tab, that tab is already the current one.
 */
export function WorkspaceHeader({ entering = false }: { entering?: boolean }) {
    const workspace = useShellInfo()?.workspace;
    // Only outside the signed-in shell, where nothing about the workspace is known
    if (!workspace)
        return <HeaderOutline />;
    const tabs = workspaceTabs(workspace);
    return (
        <PageHeader title={workspace.name}>
            <LinkTabs label="Workspace" match="path" tabs={entering ? tabs.map((tab, index) => ({ ...tab, current: index === 0 })) : tabs} />
        </PageHeader>
    );
}
