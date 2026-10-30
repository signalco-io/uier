import type { AppDoc } from '../model';

/**
 * A Google sign-in in progress (`ttl` 10 minutes). The browser holds only its id in a signed
 * cookie. The state and nonce are stored as SHA-256 hashes; the PKCE verifier is never stored (it
 * is a keyed hash of the id and state, see `pkceVerifier`).
 */
export type DbGoogleSignIn = AppDoc & {
    type: 'google-sign-in';
    pk: `google-sign-in:${string}`;
    stateHash: string;
    nonceHash: string;
    /** App path to continue to (`safeNextPath`) */
    next?: string;
    /** Set when a signed-in person links Google from Account: the callback links to this user only */
    linkUserId?: string;
    createdAt: string;
    ttl: number;
};

/**
 * A verified Google account whose address already has a uier account, while the person proves the
 * inbox with an email code (`ttl` 15 minutes). Bound to the browser like `DbGoogleSignIn`.
 */
export type DbGoogleLink = AppDoc & {
    type: 'google-link';
    pk: `google-link:${string}`;
    sub: string;
    /** Normalized; the uier account's email */
    email: string;
    next?: string;
    createdAt: string;
    ttl: number;
};

/** Unique Google account -> user (the id is Google's `sub`). Google sign-in matches on this only, never on email. */
export type DbUserIdentity = AppDoc & {
    type: 'user-identity';
    pk: `identity:google:${string}`;
    provider: 'google';
    userId: string;
};

/** The Google account linked to a user, in the user's partition (one per user), listed on Account */
export type DbGoogleAccount = AppDoc & {
    type: 'google-account';
    /** `google` */
    id: string;
    pk: `user:${string}`;
    sub: string;
    /** The Google address, for display only: it never changes the uier email */
    email: string;
    linkedAt: string;
};

export const googleSignInPk = (id: string) => `google-sign-in:${id}` as const;
export const googleLinkPk = (id: string) => `google-link:${id}` as const;
export const googleIdentityPk = (sub: string) => `identity:google:${sub}` as const;
export const GOOGLE_ACCOUNT_ID = 'google';
