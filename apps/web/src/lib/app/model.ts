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
    /**
     * Set on a new account until it confirms or skips the first-run step (`/app/welcome`: its name and
     * its workspace's name). Accounts from before the step never had it.
     */
    welcomePending?: boolean;
    /**
     * The profile picture: its image is the {@link DbUserAvatar} with `avatarDocId(version)` in this
     * partition. Both change in one batch (`avatars.ts`); missing means initials.
     */
    avatar?: UserAvatarRef;
    /**
     * The toolbar language the person chose (toolbar Options or Account). Missing means none: the
     * project's or workspace's language shows (`lib/app/toolbarLanguage.ts`).
     */
    toolbarLanguage?: import('@uier/toolbar/languages').ToolbarLanguage;
    /** App language. Missing follows a supported browser language, then English. */
    appLanguage?: import('../i18n/languages').AppLanguage;
    createdAt: string;
    updatedAt: string;
};

/** Where a profile picture came from: uploaded on Account, or imported from a sign-in provider */
export type AvatarSource = 'upload' | 'google' | 'microsoft';

export type UserAvatarRef = {
    /** Random (nanoid), new for every image: it is in the image's address, so the browser can keep it */
    version: string;
    source: AvatarSource;
    updatedAt: string;
};

/**
 * A profile picture: a square WebP of at most `AVATAR_SIZE` pixels, re-encoded on the server
 * (`normalizeAvatar`), in the user's partition. Only the current version exists.
 */
export type DbUserAvatar = AppDoc & {
    type: 'user-avatar';
    /** `avatarDocId(version)` */
    id: string;
    pk: `user:${string}`;
    userId: string;
    source: AvatarSource;
    contentType: 'image/webp';
    /** Pixels on a side */
    size: number;
    bytes: number;
    /** Base64 */
    data: string;
    createdAt: string;
};

export const avatarDocId = (version: string) => `avatar_${version}`;

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
    /** A Google account waiting for this email proof (`DbGoogleLink`), linked only in the browser that asked */
    googleLinkId?: string;
    /** Microsoft identity waiting for browser-bound email proof. */
    microsoftLinkId?: string;
    createdAt: string;
    ttl: number;
};

export type DbWorkspace = AppDoc & {
    type: 'workspace';
    /**
     * `w_<userId>` for a user's own workspace (`w_<userId>_2`, ... after an admin removed them, see
     * `ensureOwnWorkspace`), `w_<nanoid>` for one created from the workspace menu (`createWorkspace`)
     */
    id: string;
    pk: `workspace:${string}`;
    name: string;
    createdBy: string;
    createdAt: string;
    /** Serializes member removals through a conditional workspace/member transaction. */
    memberRemovalVersion?: number;
    /** Serializes workspace access mutations in conditional transactions. */
    accessRevision?: number;
    /** AI thread titles (`lib/titles`). Missing means on: no migration for existing workspaces. */
    aiTitles?: boolean;
    /** Admin-only style guidance for rewrite suggestions. Never project/reviewer DTO data. */
    rewriteInstructions?: string;
    /** Default statuses within the five semantic categories. Missing keeps the built-in workflow. */
    threadLabels?: import('./threadLabel').ThreadLabel[];
    statusWorkflow?: import('./statusWorkflow').StatusWorkflow;
    /** Defaults for each project's Give feedback form. Missing keeps the standard types. */
    feedbackTypes?: import('@uier/toolbar/feedback-types').FeedbackType[];
    /** The toolbar language of the workspace's projects. Missing means English: no migration for existing workspaces. */
    toolbarLanguage?: import('@uier/toolbar/languages').ToolbarLanguage;
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
    /** Overrides the workspace's AI thread titles. Missing means the workspace setting (`lib/titles/settings.ts`). */
    aiTitles?: 'on' | 'off';
    /** Missing inherits the workspace. Empty replace intentionally uses no style guidance. */
    rewriteInstructions?: import('./inheritedSettings').ProjectSetting<string>;
    /** Per-project opt-in. Missing and false both disable fix verification. */
    verificationEnabled?: boolean;
    /** Missing inherits live workspace statuses; replace keeps the project's complete workflow. */
    threadLabels?: { mode: 'replace'; value: import('./threadLabel').ThreadLabel[] };
    statusWorkflow?: { mode: 'replace'; value: import('./statusWorkflow').StatusWorkflow };
    /** Missing inherits the workspace list; replace keeps a project's own list. */
    feedbackTypes?: import('./inheritedSettings').ProjectSetting<import('@uier/toolbar/feedback-types').FeedbackType[]>;
    /** Overrides the workspace's toolbar language. Missing means the workspace's (`lib/app/toolbarLanguage.ts`). */
    toolbarLanguage?: import('@uier/toolbar/languages').ToolbarLanguage;
    /** Optional toolbar tools; missing lists show all current and future tools. */
    toolbarFeatures?: import('@uier/toolbar/toolbar-features').ToolbarFeatureVisibility;
    /** Server-owned provider bindings. Secrets and provider settings live in separate records. */
    integrations?: Partial<Record<import('../integrations/model').IntegrationProviderId, import('../integrations/model').IntegrationBinding>>;
    /** Optional labels and explicit alias groups, keyed by configured origin. */
    environments?: import('./environments').ProjectEnvironment[];
    /**
     * How each column of the comments board orders its cards, for everyone who opens it (`lib/app/boardSort.ts`).
     * Only columns with a choice other than their default; missing means today's order everywhere.
     */
    boardSorts?: import('./boardSort').BoardSorts;
    /** Whether the board's Archive column, its last, is expanded for everyone who opens it; missing means collapsed */
    boardArchiveExpanded?: true;
    boardGroupByLabel?: boolean;
    status: ProjectStatus;
    access: ProjectAccess;
    /**
     * Set while a transfer to another workspace runs (`projectTransfer.ts`): the document then exists in
     * both workspaces, and only the one whose workspace the project code names is the project
     * (`isLiveProject`). Cleared once the move is finished or abandoned.
     */
    transfer?: { from: string; to: string };
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
    /** Current image in the workspace partition; swapped with its image using this document's etag. */
    logo?: { version: string; updatedAt: string };
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

/** A client logo, normalized with the profile picture limits. Only the current version exists. */
export type DbClientLogo = AppDoc & {
    type: 'client-logo';
    pk: `workspace:${string}`;
    workspaceId: string;
    clientId: string;
    contentType: 'image/webp';
    size: number;
    bytes: number;
    data: string;
    createdAt: string;
};

export const clientLogoDocId = (version: string) => `client_logo_${version}`;

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

/**
 * A deleted project's code: the claim stays, so the code is never issued again, but it names no
 * workspace. Integration discovery reads it as proof that the project's deletion intents can be dropped.
 */
export type DbRetiredProjectRef = AppDoc & {
    type: 'project-ref-retired';
    pk: `project:${string}`;
    retiredAt: string;
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

/**
 * A passkey (WebAuthn credential) in its user's partition, listed on Account. It is the source of
 * truth: sign-in finds it through `DbPasskeyCredential` and rejects the credential once it is gone.
 */
export type DbPasskey = AppDoc & {
    type: 'passkey';
    /** `passkey_<SHA-256 of the credential id>` */
    id: string;
    pk: `user:${string}`;
    /** base64url, as the authenticator returns it */
    credentialId: string;
    /** COSE public key, base64url */
    publicKey: string;
    /** Signature counter; stays 0 on authenticators without one */
    counter: number;
    transports: string[];
    /** Authenticator model (all zeros when the authenticator doesn't say) */
    aaguid: string;
    deviceType: 'singleDevice' | 'multiDevice';
    /** Synced to a password manager or another device */
    backedUp: boolean;
    name: string;
    createdAt: string;
    lastUsedAt?: string;
};

/** Unique credential id -> user, for a point read at sign-in (id: SHA-256 of the credential id) */
export type DbPasskeyCredential = AppDoc & {
    type: 'passkey-credential';
    pk: `passkey:${string}`;
    userId: string;
    createdAt: string;
};

/** A single-use WebAuthn challenge, bound to one browser by a signed cookie with its id */
export type DbPasskeyChallenge = AppDoc & {
    type: 'passkey-challenge';
    pk: `passkey-challenge:${string}`;
    purpose: 'register' | 'sign-in';
    /** base64url */
    challenge: string;
    /** Registration only: the signed-in user who asked */
    userId?: string;
    createdAt: string;
    ttl: number;
};

/**
 * An email domain whose people can join the workspace (`workspaceDomains.ts`), in the workspace's
 * partition. Only an admin whose own account email is at the domain can add it; every write goes
 * through `mutateAccess` with an access event.
 */
export type DbWorkspaceDomain = AppDoc & {
    type: 'workspace-domain';
    /** `domain_<domain>` */
    id: string;
    pk: `workspace:${string}`;
    workspaceId: string;
    /** Lowercase ASCII (`example.com`), without a trailing dot */
    domain: string;
    /** Teams people who join get, with each team's invitation generation when it was chosen */
    teamIds: string[];
    teamGenerations: Record<string, number>;
    /** How the domain was verified: the adding admin's account email is at it, proven by a sign-in in the last 10 minutes */
    verification: 'admin-email';
    addedBy: string;
    addedAt: string;
    updatedAt: string;
};

/**
 * Domain -> a workspace people at it can join, for the lookup at sign-in (`domain:<domain>`, id: the
 * workspace id). It counts only while that workspace's {@link DbWorkspaceDomain} exists.
 */
export type DbDomainWorkspace = AppDoc & {
    type: 'domain-workspace';
    pk: `domain:${string}`;
    workspaceId: string;
    createdAt: string;
};

export const workspacePk =(workspaceId: string) => `workspace:${workspaceId}` as const;
export const userPk = (userId: string) => `user:${userId}` as const;
export const emailPk = (email: string) => `email:${email}` as const;
export const projectRefPk = (projectId: string) => `project:${projectId}` as const;
export const memberId = (userId: string) => `member_${userId}`;
