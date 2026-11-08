import { randomBytes } from 'node:crypto';
import { getAppStore } from '../store';
import { fromPendingPicture, importProviderAvatar, type PendingPicture } from '../avatars';
import { boundMicrosoftRecordId, microsoftBindingToken } from './cookie';
import { linkMicrosoftAccount } from './identity';
import { microsoftLinkPk, type DbMicrosoftLink } from './model';

/** As long as the sign-in email it waits for */
export const MICROSOFT_LINK_TTL_SECONDS = 15 * 60;

/** A verified identity waits for a browser-bound proof of the user-chosen inbox. */
export async function createMicrosoftLink(microsoft: { subject: string; email: string; picture?: PendingPicture }, next: string | undefined) {
    const id = randomBytes(32).toString('hex');
    await getAppStore().create<DbMicrosoftLink>({ type: 'microsoft-link', id, pk: microsoftLinkPk(id), subject: microsoft.subject, email: microsoft.email,
        next, ...(microsoft.picture ? { picture: microsoft.picture } : {}), createdAt: new Date().toISOString(), ttl: MICROSOFT_LINK_TTL_SECONDS });
    return { id, binding: microsoftBindingToken('link', id, MICROSOFT_LINK_TTL_SECONDS) };
}

async function getMicrosoftLinkById(id: string) {
    const link = (await getAppStore().get<DbMicrosoftLink>(microsoftLinkPk(id), id))?.doc;
    // The in-memory store has no TTL deletion; Cosmos may delete expired items late
    return link && Date.parse(link.createdAt) + MICROSOFT_LINK_TTL_SECONDS * 1000 > Date.now() ? link : null;
}

/** The Microsoft account waiting in this browser (its cookie), or `null` */
export async function getMicrosoftLink(binding: string | undefined) {
    const id = boundMicrosoftRecordId('link', binding);
    return id ? await getMicrosoftLinkById(id) : null;
}

/** Only the explicit Microsoft confirmation form attaches this browser's pending identity. */
export async function microsoftLinkIdFor(binding: string | undefined) {
    const link = await getMicrosoftLink(binding);
    return link?.id;
}

/**
 * Links the waiting Microsoft account after a browser-bound email proof. The
 * winner of the delete links; an expired or used link links nothing (`null`). Once linked, the
 * Microsoft photo becomes the account's picture if it has none.
 */
export async function completeMicrosoftLink(id: string, userId: string) {
    const link = await getMicrosoftLinkById(id);
    if (!link || !await getAppStore().delete(link.pk, link.id))
        return null;
    const result = await linkMicrosoftAccount(userId, { subject: link.subject, email: link.email });
    if (result === 'linked')
        await importProviderAvatar(userId, 'microsoft', async () => fromPendingPicture(link.picture));
    return result;
}
