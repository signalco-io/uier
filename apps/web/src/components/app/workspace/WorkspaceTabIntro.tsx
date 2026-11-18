'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useShellInfo } from '../shell/ShellInfo';
import { WorkspaceTabHeader } from './WorkspaceTabHeader';
import { managesWorkspace } from './workspaceTabs';

/**
 * The opening line of a tab whose header holds nothing else: outside the tab's data boundary, so it is there at once
 * and stays while the list under it loads. `description` is a source phrase. With `manages` the tab is for those who
 * manage the workspace: the page itself says so (404), and the line is not shown to anyone the shell knows is not one.
 */
export function WorkspaceTabIntro({ description, manages = false }: { description: string; manages?: boolean }) {
    const { t } = useAppI18n();
    const workspace = useShellInfo()?.workspace;
    if (manages && workspace && !managesWorkspace(workspace))
        return null;
    return <WorkspaceTabHeader description={t(description)} />;
}
