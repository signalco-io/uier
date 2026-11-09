import { KnownPages } from '../../knownPages';
import type { EmailProof } from './emailProof';
import type { DbUser } from './model';
import { safeNextPath } from './signIn';
import { getUser } from './users';
import { hasDomainJoinOffer } from './workspaceDomains';

const isJoinPage = (path: string) => path.split(/[?#]/, 1)[0] === KnownPages.AppJoin;

/** Where the join page continues (Join or Not now): its safe `next`, never the join page itself, or the app */
export function joinNextPath(next: unknown) {
    const path = safeNextPath(next);
    return path && !isJoinPage(path) ? path : KnownPages.App;
}

/**
 * Where a finished sign-in continues: the join page first when the sign-in proved the account's email
 * (`proof`, what `startSession` returned) and a workspace offers its domain (`workspaceDomains.ts`), with
 * `destination` as its `next`, otherwise `destination`. A sign-in that proved no email (a passkey, a linked
 * Microsoft account) looks nothing up. A failed lookup never stops the sign-in.
 */
export async function signInDestination(user: DbUser | string, destination: string, proof: EmailProof | null) {
    if (isJoinPage(destination) || !proof)
        return destination;
    try {
        const account = typeof user === 'string' ? await getUser(user) : user;
        if (account && await hasDomainJoinOffer(account, proof))
            return `${KnownPages.AppJoin}?${new URLSearchParams({ next: destination })}`;
    } catch (error) {
        console.error('[app] Domain join lookup failed', error);
    }
    return destination;
}
