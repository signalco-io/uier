import type { AppContext } from '@/src/lib/app/context';
import { ownWorkspaceId } from '@/src/lib/app/workspaces';

/**
 * The workspace made for a new account (`ensureOwnWorkspace`), which the first-run step names. Someone
 * who joined by invitation has none: the step asks only for their name.
 */
export function welcomeWorkspace(context: AppContext) {
    const own = ownWorkspaceId(context.user.id);
    return context.memberships.find(({ member, workspace }) => member.role === 'admin'
        && workspace.createdBy === context.user.id
        && (workspace.id === own || workspace.id.startsWith(`${own}_`)))?.workspace;
}
