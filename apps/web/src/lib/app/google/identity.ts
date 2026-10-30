import { getAppStore } from '../store';
import { userPk } from '../model';
import { getUser } from '../users';
import { GOOGLE_ACCOUNT_ID, googleIdentityPk, type DbGoogleAccount, type DbUserIdentity } from './model';

/** Google's `sub`: case-sensitive ASCII, at most 255 characters (numeric in practice) */
export function isGoogleSubject(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value);
}

export async function getGoogleAccount(userId: string) {
    return (await getAppStore().get<DbGoogleAccount>(userPk(userId), GOOGLE_ACCOUNT_ID))?.doc ?? null;
}

/**
 * The user a Google account signs in as, or `null`. The claim and the user's own record must agree:
 * unlinking deletes the user's record first, so sign-in stops even if deleting the claim fails.
 */
export async function findUserByGoogleSubject(sub: string) {
    const claim = await getAppStore().get<DbUserIdentity>(googleIdentityPk(sub), sub);
    if (!claim || (await getGoogleAccount(claim.doc.userId))?.sub !== sub)
        return null;
    return await getUser(claim.doc.userId);
}

/** `taken`: the Google account belongs to another user. `other_account`: this user has another one. */
export type GoogleLinkResult = 'linked' | 'taken' | 'other_account';

/**
 * Links a Google account to a user: the user's record first (one per user), then the unique
 * `sub` -> user claim, like `findOrCreateUser`. A claim left by an interrupted unlink (its user no
 * longer lists the account) is replaced; a claim of another user's linked account is not.
 */
export async function linkGoogleAccount(userId: string, google: { sub: string; email: string }): Promise<GoogleLinkResult> {
    if (!isGoogleSubject(google.sub))
        throw new Error('Invalid Google account');
    const store = getAppStore();
    const account: DbGoogleAccount = { type: 'google-account', id: GOOGLE_ACCOUNT_ID, pk: userPk(userId),
        sub: google.sub, email: google.email, linkedAt: new Date().toISOString() };
    const created = await store.create(account);
    if (!created && (await getGoogleAccount(userId))?.sub !== google.sub)
        return 'other_account';

    const pk = googleIdentityPk(google.sub);
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await store.create<DbUserIdentity>({ type: 'user-identity', id: google.sub, pk, provider: 'google', userId }))
            return 'linked';
        const claim = await store.get<DbUserIdentity>(pk, google.sub);
        if (!claim)
            continue;
        if (claim.doc.userId === userId)
            return 'linked';
        if ((await getGoogleAccount(claim.doc.userId))?.sub === google.sub) {
            if (created)
                await store.delete(account.pk, account.id);
            return 'taken';
        }
        await store.transact([{ kind: 'delete', pk, id: google.sub, etag: claim.etag }]);
    }
    throw new Error('Could not link the Google account');
}

/** Email sign-in always stays available, so unlinking is always allowed. */
export async function unlinkGoogleAccount(userId: string) {
    const store = getAppStore();
    const account = await getGoogleAccount(userId);
    if (!account)
        return;
    await store.delete(account.pk, account.id);
    const claim = await store.get<DbUserIdentity>(googleIdentityPk(account.sub), account.sub);
    if (claim?.doc.userId === userId)
        await store.transact([{ kind: 'delete', pk: claim.doc.pk, id: claim.doc.id, etag: claim.etag }]);
}

/** Keeps the address shown on Account current. It never changes the uier email or how sign-in matches. */
export async function refreshGoogleAccountEmail(userId: string, sub: string, email: string) {
    const store = getAppStore();
    const stored = await store.get<DbGoogleAccount>(userPk(userId), GOOGLE_ACCOUNT_ID);
    if (stored && stored.doc.sub === sub && stored.doc.email !== email)
        await store.replace({ ...stored.doc, email }, stored.etag);
}
