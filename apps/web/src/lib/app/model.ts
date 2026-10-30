import type { PageStatePolicy } from '@uier/toolbar/page-state';
import type { ClientColor, ClientIcon } from './clientAppearance';

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

/** A sign-in email; the link and browser-bound code share this single-use request */
export type DbSignInRequest = AppDoc & {
    type: 'sign-in';
    pk: `sign-in:${string}`;
    email: string;
    /** Request-specific HMAC of the numeric code. Missing on older, link-only requests. */
    codeHash?: string;
    /** App path to continue to after signing in */
    next?: string;
    createdAt: string;
    ttl: number;
};

export type DbWorkspace = AppDoc & {
    type: 'workspace';
    /** `w_<userId>` for a user's own workspace (`w_<userId>_2`, ... after an admin removed them, see `ensureOwnWorkspace`) */
    id: string;
    pk: `workspace:${string}`;
    name: string;
    createdBy: string;
    createdAt: string;
    /** Serializes member removals through a conditional workspace/member transaction. */
    memberRemovalVersion?: number;
    /** Serializes workspace access mutations in conditional transactions. */
    accessRevision?: number;
};

export type MemberRole = 'admin' | 'commenter';
export type MemberRelationship = 'internal' | 'external';

export type DbTeam = AppDoc & {
    type: 'team'; workspaceId: string; name: string; nameKey: string;
    description?: string;
    state: 'active' | 'archived' | 'deleted';
    invitationGeneration?: number;
    projectIds: string[];
    createdBy: string; createdAt: string; updatedBy: string; updatedAt: string;
    archivedAt?: string;
};
export type DbTeamName = AppDoc & { type: 'team-name'; workspaceId: string; teamId: string };
/** Revocation generations for invitation recipients and issuing admins. */
export type DbAccessGeneration = AppDoc & { type: 'access-generation'; generation: number };
export type DbAccessEvent = AppDoc & {
    type: 'access-event'; workspaceId: string; actorId: string; at: string;
    action: string; targetIds: string[];
    before: Record<string, unknown>; after: Record<string, unknown>; ttl: number;
};

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
    teamIds?: string[];
    relationship?: MemberRelationship;
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
    /** Internal id, retained for storage, memberships and existing random review codes. */
    id: string;
    /** Independent 21-character Nano ID for public review links and embeds. Assigned lazily on old projects. */
    publicId?: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    name: string;
    /** The project's client (`DbClient`). Optional: a project without one has no client. */
    clientId?: string;
    /**
     * Older projects only: the client's name from before clients were documents. `ensureProjectClient`
     * (`clients.ts`) moves it to `clientId` the first time the project is listed or read.
     */
    clientName?: string;
    /** Plain-text instructions shared only with people who can comment. */
    brief?: string;
    /** Site URLs (origin and optional path); the first one is the main site */
    urls: string[];
    /** Opt-in meaningful URL state. Missing on older projects: pathname only. */
    pageState?: PageStatePolicy;
    /** Opt-in comment text in review emails, including verified guest recipients. */
    emailCommentExcerpts?: boolean;
    /** Server-owned provider bindings. Secrets and provider settings live in separate records. */
    integrations?: Partial<Record<import('../integrations/model').IntegrationProviderId, import('../integrations/model').IntegrationBinding>>;
    /** Optional labels and explicit alias groups, keyed by configured origin. */
    environments?: import('./environments').ProjectEnvironment[];
    status: ProjectStatus;
    access: ProjectAccess;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * Who a workspace's projects are for. Projects point to it with `clientId`, so renaming a client is
 * one write that every project follows. The name is unique in the workspace (`DbClientName`).
 */
export type DbClient = AppDoc & {
    type: 'client';
    /** `client_<nanoid>` */
    id: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    /** Normalized with `projectClientNameSchema` */
    name: string;
    description?: string;
    icon?: ClientIcon;
    color?: ClientColor;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

/** Client name -> client (`client_name_<sha256 of the name>`), so a name belongs to one client of the workspace */
export type DbClientName = AppDoc & {
    type: 'client-name';
    pk: `workspace:${string}`;
    workspaceId: string;
    clientId: string;
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
    teamIds?: string[];
    relationship?: MemberRelationship;
    recipientGeneration?: number;
    issuerGeneration?: number;
    teamGenerations?: Record<string, number>;
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
