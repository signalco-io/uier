import type { AppDoc } from '../model';
import type { PendingPicture } from '../avatars';

/**
 * A Microsoft sign-in in progress (`ttl` 10 minutes). The browser holds only its id in a signed
 * cookie. The state and nonce are stored as SHA-256 hashes; the PKCE verifier is never stored (it
 * is a keyed hash of the id and state, see `pkceVerifier`).
 */
export type DbMicrosoftSignIn = AppDoc & {
    type: 'microsoft-sign-in';
    pk: `microsoft-sign-in:${string}`;
    stateHash: string;
    nonceHash: string;
    /** App path to continue to (`safeNextPath`) */
    next?: string;
    /** Set when a signed-in person links Microsoft from Account: the callback links to this user only */
    linkUserId?: string;
    createdAt: string;
    ttl: number;
};

/**
 * A Microsoft identity waiting while the person chooses and proves an
 * inbox with an email code (`ttl` 15 minutes). Bound to the browser like `DbMicrosoftSignIn`.
 */
export type DbMicrosoftLink = AppDoc & {
    type: 'microsoft-link';
    pk: `microsoft-link:${string}`;
    subject: string;
    /** Suggested address only, never mailbox proof. May be empty. */
    email: string;
    next?: string;
    /**
     * The Microsoft profile photo, fetched with the sign-in's access token at the callback (the
     * token itself is never stored), for an account without a picture once the link completes
     */
    picture?: PendingPicture;
    createdAt: string;
    ttl: number;
};

/** Unique Microsoft identity -> user. The id is SHA-256(issuer + newline + sub). */
export type DbUserIdentity = AppDoc & {
    type: 'user-identity';
    pk: `identity:microsoft:${string}`;
    provider: 'microsoft';
    userId: string;
};

/** The Microsoft account linked to a user, in the user's partition (one per user), listed on Account */
export type DbMicrosoftAccount = AppDoc & {
    type: 'microsoft-account';
    /** `microsoft` */
    id: string;
    pk: `user:${string}`;
    subject: string;
    /** The Microsoft address, for display only: it never changes the uier email */
    email: string;
    linkedAt: string;
};

export const microsoftSignInPk = (id: string) => `microsoft-sign-in:${id}` as const;
export const microsoftLinkPk = (id: string) => `microsoft-link:${id}` as const;
export const microsoftIdentityPk = (subject: string) => `identity:microsoft:${subject}` as const;
export const MICROSOFT_ACCOUNT_ID = 'microsoft';
