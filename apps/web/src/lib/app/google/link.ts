import { randomBytes } from 'node:crypto';
import { getAppStore } from '../store';
import { boundGoogleRecordId, googleBindingToken } from './cookie';
import { linkGoogleAccount } from './identity';
import { googleLinkPk, type DbGoogleLink } from './model';

/** As long as the sign-in email it waits for */
export const GOOGLE_LINK_TTL_SECONDS = 15 * 60;

/**
 * Rule 4 of Google sign-in: the address already has a uier account and Google is not authoritative
 * for it. The verified Google account waits here, bound to this browser, until the person proves
 * the inbox with the email code flow (`requestSignInLink` then `consumeSignInRequest`).
 */
export async function createGoogleLink(google: { sub: string; email: string }, next: string | undefined) {
    const id = randomBytes(32).toString('hex');
    await getAppStore().create<DbGoogleLink>({ type: 'google-link', id, pk: googleLinkPk(id), sub: google.sub, email: google.email,
        next, createdAt: new Date().toISOString(), ttl: GOOGLE_LINK_TTL_SECONDS });
    return { id, binding: googleBindingToken('link', id, GOOGLE_LINK_TTL_SECONDS) };
}

async function getGoogleLinkById(id: string) {
    const link = (await getAppStore().get<DbGoogleLink>(googleLinkPk(id), id))?.doc;
    // The in-memory store has no TTL deletion; Cosmos may delete expired items late
    return link && Date.parse(link.createdAt) + GOOGLE_LINK_TTL_SECONDS * 1000 > Date.now() ? link : null;
}

/** The Google account waiting in this browser (its cookie), or `null` */
export async function getGoogleLink(binding: string | undefined) {
    const id = boundGoogleRecordId('link', binding);
    return id ? await getGoogleLinkById(id) : null;
}

/** The pending link a sign-in email for this address may carry: only this browser's, only for its address */
export async function googleLinkIdFor(binding: string | undefined, email: string) {
    const link = await getGoogleLink(binding);
    return link?.email === email ? link.id : undefined;
}

/**
 * Links the waiting Google account after a browser-bound email proof for the same address. The
 * winner of the delete links; an expired, used or mismatched link links nothing (`null`).
 */
export async function completeGoogleLink(id: string, userId: string, email: string) {
    const link = await getGoogleLinkById(id);
    if (!link || link.email !== email || !await getAppStore().delete(link.pk, link.id))
        return null;
    return await linkGoogleAccount(userId, { sub: link.sub, email: link.email });
}
