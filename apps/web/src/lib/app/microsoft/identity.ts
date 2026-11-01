import { getAppStore } from '../store';
import { userPk } from '../model';
import { getUser } from '../users';
import { MICROSOFT_ACCOUNT_ID, microsoftIdentityPk, type DbMicrosoftAccount, type DbUserIdentity } from './model';

/** SHA-256 of the validated issuer and subject, safe as a Cosmos id. */
export function isMicrosoftSubject(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export async function getMicrosoftAccount(userId: string) {
    return (await getAppStore().get<DbMicrosoftAccount>(userPk(userId), MICROSOFT_ACCOUNT_ID))?.doc ?? null;
}

/**
 * The user a Microsoft account signs in as, or `null`. The claim and the user's own record must agree:
 * unlinking deletes the user's record first, so sign-in stops even if deleting the claim fails.
 */
export async function findUserByMicrosoftSubject(subject: string) {
    const claim = await getAppStore().get<DbUserIdentity>(microsoftIdentityPk(subject), subject);
    if (!claim || (await getMicrosoftAccount(claim.doc.userId))?.subject !== subject)
        return null;
    return await getUser(claim.doc.userId);
}

/** `taken`: the Microsoft account belongs to another user. `other_account`: this user has another one. */
export type MicrosoftLinkResult = 'linked' | 'taken' | 'other_account';

/**
 * Links a Microsoft account to a user: the user's record first (one per user), then the unique
 * `subject` -> user claim, like `findOrCreateUser`. A claim left by an interrupted unlink (its user no
 * longer lists the account) is replaced; a claim of another user's linked account is not.
 */
export async function linkMicrosoftAccount(userId: string, microsoft: { subject: string; email: string }): Promise<MicrosoftLinkResult> {
    if (!isMicrosoftSubject(microsoft.subject))
        throw new Error('Invalid Microsoft account');
    const store = getAppStore();
    const account: DbMicrosoftAccount = { type: 'microsoft-account', id: MICROSOFT_ACCOUNT_ID, pk: userPk(userId),
        subject: microsoft.subject, email: microsoft.email, linkedAt: new Date().toISOString() };
    const created = await store.create(account);
    if (!created && (await getMicrosoftAccount(userId))?.subject !== microsoft.subject)
        return 'other_account';

    const pk = microsoftIdentityPk(microsoft.subject);
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await store.create<DbUserIdentity>({ type: 'user-identity', id: microsoft.subject, pk, provider: 'microsoft', userId }))
            return 'linked';
        const claim = await store.get<DbUserIdentity>(pk, microsoft.subject);
        if (!claim)
            continue;
        if (claim.doc.userId === userId)
            return 'linked';
        if ((await getMicrosoftAccount(claim.doc.userId))?.subject === microsoft.subject) {
            if (created)
                await store.delete(account.pk, account.id);
            return 'taken';
        }
        await store.transact([{ kind: 'delete', pk, id: microsoft.subject, etag: claim.etag }]);
    }
    throw new Error('Could not link the Microsoft account');
}

/** Email sign-in always stays available, so unlinking is always allowed. */
export async function unlinkMicrosoftAccount(userId: string) {
    const store = getAppStore();
    const account = await getMicrosoftAccount(userId);
    if (!account)
        return;
    await store.delete(account.pk, account.id);
    const claim = await store.get<DbUserIdentity>(microsoftIdentityPk(account.subject), account.subject);
    if (claim?.doc.userId === userId)
        await store.transact([{ kind: 'delete', pk: claim.doc.pk, id: claim.doc.id, etag: claim.etag }]);
}

/** Keeps the address shown on Account current. It never changes the uier email or how sign-in matches. */
export async function refreshMicrosoftAccountEmail(userId: string, subject: string, email: string) {
    const store = getAppStore();
    const stored = await store.get<DbMicrosoftAccount>(userPk(userId), MICROSOFT_ACCOUNT_ID);
    if (stored && stored.doc.subject === subject && stored.doc.email !== email)
        await store.replace({ ...stored.doc, email }, stored.etag);
}
