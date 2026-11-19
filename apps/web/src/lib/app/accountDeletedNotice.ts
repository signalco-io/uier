import { signToken, verifyToken } from './tokens';

/** Long enough for the redirect and a reload; a copied link says nothing later. */
const NOTICE_SECONDS = 120;

/**
 * The `deleted` value of the page a deletion continues on. It is signed and names the account the browser
 * continues as (`null`: signed out), so a link someone else made cannot tell a person their account is gone.
 */
export function accountDeletedNotice(continuesAs: string | null) {
    return signToken('account-deleted', { to: continuesAs ?? '' }, NOTICE_SECONDS);
}

export function isAccountDeletedNotice(value: unknown, continuesAs: string | null) {
    const notice = typeof value === 'string' ? verifyToken<{ to?: unknown }>('account-deleted', value) : null;
    return notice !== null && notice.to === (continuesAs ?? '');
}
