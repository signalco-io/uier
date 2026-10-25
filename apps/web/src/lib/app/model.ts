import type { PageStatePolicy } from '@uier/toolbar/page-state';

// Documents of the `app` container (partition key `/pk`). Ids and partition keys are set by the
// server only. Related documents share a partition: a workspace with its members and projects.

export type AppDoc = {
    id: string;
    /** Partition key */
    pk: string;
    type: string;
    /** Seconds; Cosmos DB per-item TTL, counted from the last write */
    ttl?: number;
};

export type DbUser = AppDoc & {
    type: 'user';
    /** `u_<nanoid>` */
    id: string;
    pk: `user:${string}`;
    /** Normalized (trimmed, lowercase) */
    email: string;
    /** Display name on comments; defaults to the part of the email before the @ */
    name: string;
    createdAt: string;
    updatedAt: string;
};

/** Unique email -> user (the id is the normalized email, so a second user with it can't be created) */
export type DbUserEmail = AppDoc & {
    type: 'user-email';
    pk: `email:${string}`;
    userId: string;
};

/** A sign-in link that was sent; the id is the SHA-256 of the token in the link */
export type DbSignInRequest = AppDoc & {
    type: 'sign-in';
    pk: `sign-in:${string}`;
    email: string;
    /** App path to continue to after signing in */
    next?: string;
    createdAt: string;
    ttl: number;
};

export type DbWorkspace = AppDoc & {
    type: 'workspace';
    /** `w_<userId>` for a user's own workspace */
    id: string;
    pk: `workspace:${string}`;
    name: string;
    createdBy: string;
    createdAt: string;
};

export type MemberRole = 'admin' | 'commenter';

/** Projects a member can review: every project of the workspace, or the listed ones */
export type ProjectsAccess = 'all' | string[];

export type DbMember = AppDoc & {
    type: 'member';
    /** `member_<userId>` */
    id: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    userId: string;
    /** Copy of the user's email (it never changes), so lists need no extra reads */
    email: string;
    role: MemberRole;
    /** Admins always have every project */
    projects: ProjectsAccess;
    createdAt: string;
};

/**
 * Who can comment through the toolbar:
 * - `disabled`: nobody (the toolbar shows that comments are turned off)
 * - `invited`: members of the workspace with access to the project
 * - `guests`: anyone with the review link; guests tag their comments with their name
 */
export type ProjectAccess = 'disabled' | 'invited' | 'guests';

export type ProjectStatus = 'active' | 'done';

export type DbProject = AppDoc & {
    type: 'project';
    /** The public project code used by the embed script, e.g. `k3m9x2p7q4ab` */
    id: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    name: string;
    /** Optional client label, normalized whitespace; older projects have no client. */
    clientName?: string;
    /** Site URLs (origin and optional path); the first one is the main site */
    urls: string[];
    /** Opt-in meaningful URL state. Missing on older projects: pathname only. */
    pageState?: PageStatePolicy;
    /** Optional labels and explicit alias groups, keyed by configured origin. */
    environments?: import('./environments').ProjectEnvironment[];
    status: ProjectStatus;
    access: ProjectAccess;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

/** Project code -> workspace, so the toolbar can find a project with a point read */
export type DbProjectRef = AppDoc & {
    type: 'project-ref';
    pk: `project:${string}`;
    workspaceId: string;
};

/** A pending invitation to a workspace (in the workspace's partition, listed with its members) */
export type DbInvitation = AppDoc & {
    type: 'invitation';
    /** `invitation_<nanoid>` */
    id: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    /** Normalized email of the invited person */
    email: string;
    role: MemberRole;
    projects: ProjectsAccess;
    /** The project to open after accepting (the invitation was made from a project) */
    projectId?: string;
    invitedBy: string;
    createdAt: string;
    expiresAt: string;
    /** SHA-256 of the token in the invitation link */
    tokenHash: string;
};

/** Invitation link token -> invitation (single use, expires with the invitation) */
export type DbInvitationToken = AppDoc & {
    type: 'invitation-token';
    pk: `invitation:${string}`;
    workspaceId: string;
    invitationId: string;
    ttl: number;
};

export const workspacePk = (workspaceId: string) => `workspace:${workspaceId}` as const;
export const userPk = (userId: string) => `user:${userId}` as const;
export const emailPk = (email: string) => `email:${email}` as const;
export const projectRefPk = (projectId: string) => `project:${projectId}` as const;
export const memberId = (userId: string) => `member_${userId}`;
