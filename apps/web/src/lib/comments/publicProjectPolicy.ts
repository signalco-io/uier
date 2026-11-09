import { emailSchema } from '../app/email';
import type { DbMember } from '../app/model';
import { UserFacingError } from '../app/actionErrors';

/** Guests' feedback on uier's own pages */
export const PUBLIC_PROJECT_ID = 'uier00000001';
/** Feedback from signed-in accounts on uier's own pages and the app, private to its author and uier's staff */
export const USER_FEEDBACK_PROJECT_ID = 'uier00000002';
export const PUBLIC_WORKSPACE_ID = 'w_uier_public';

/** uier's own feedback projects: no integrations, owner email, triage or member limits for commenters */
export function isUierFeedbackProject(projectId: string | undefined) {
    return projectId === PUBLIC_PROJECT_ID || projectId === USER_FEEDBACK_PROJECT_ID;
}

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
    // Accounts leave feedback in the user feedback project; the public project is for guests (and staff).
    return { ...member, role: staff ? 'admin' : 'commenter', projects: staff ? 'all' : [USER_FEEDBACK_PROJECT_ID], ttl: -1 };
}

export function assertMutableWorkspace(workspaceId: string) {
    if (workspaceId === PUBLIC_WORKSPACE_ID)
        throw new UserFacingError('Everyone joins the uier workspace automatically.');
}

export function assertMutableProject(workspaceId: string, projectId: string) {
    if (workspaceId === PUBLIC_WORKSPACE_ID || isUierFeedbackProject(projectId))
        throw new UserFacingError('The settings of uier’s feedback projects are managed by uier.');
}
