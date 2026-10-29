import { emailSchema } from '../app/email';
import type { DbMember } from '../app/model';
import { UserFacingError } from '../app/actionErrors';

export const PUBLIC_PROJECT_ID = 'uier00000001';
export const PUBLIC_WORKSPACE_ID = 'w_uier_public';

/** Addresses stay server-side. Invalid entries never prevent sign-in or public reads. */
export function isPublicProjectStaff(email: string) {
    const normalized = emailSchema.safeParse(email);
    if (!normalized.success) return false;
    return (process.env.UIER_STAFF_EMAILS ?? '').split(/[,;\n]/).some(entry => {
        const parsed = emailSchema.safeParse(entry);
        return parsed.success && parsed.data === normalized.data;
    });
}

/** The allowlist is authoritative, including before an old stored role has been reset. */
export function publicProjectMember(member: DbMember, email: string): DbMember {
    if (member.workspaceId !== PUBLIC_WORKSPACE_ID) return member;
    const staff = isPublicProjectStaff(email);
    return { ...member, role: staff ? 'admin' : 'commenter', projects: staff ? 'all' : [PUBLIC_PROJECT_ID], ttl: -1 };
}

export function assertMutableWorkspace(workspaceId: string) {
    if (workspaceId === PUBLIC_WORKSPACE_ID)
        throw new UserFacingError('Everyone joins the uier workspace automatically.');
}

export function assertMutableProject(workspaceId: string, projectId: string) {
    if (workspaceId === PUBLIC_WORKSPACE_ID || projectId === PUBLIC_PROJECT_ID)
        throw new UserFacingError('The public feedback project settings are managed by uier.');
}
