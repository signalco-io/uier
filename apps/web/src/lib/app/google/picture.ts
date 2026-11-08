import { isLocalRuntime } from '../../comments/environment';
import { AVATAR_SIZE } from '../avatarLimits';

/** The local stand-in's origin (`GOOGLE_OAUTH_ISSUER`), only in local runtime */
function localPictureOrigin() {
    const issuer = process.env.GOOGLE_OAUTH_ISSUER;
    if (!isLocalRuntime() || !issuer) return undefined;
    try {
        const url = new URL(issuer);
        return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The ID token's `picture` claim when it is a Google profile picture: HTTPS on Google's image
 * servers (`*.googleusercontent.com`), asked for at the avatar's size (`=s96-c` becomes
 * `=s256-c`). Anything else is ignored, so the server only ever fetches Google's own address.
 */
export function googlePictureUrl(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 2048) return undefined;
    let url: URL;
    try { url = new URL(value); }
    catch { return undefined; }
    if (url.username || url.password || url.hash) return undefined;
    const google = url.protocol === 'https:' && !url.port && url.hostname.endsWith('.googleusercontent.com');
    if (!google && url.origin !== localPictureOrigin()) return undefined;
    url.pathname = url.pathname.replace(/=s\d{1,4}(-c)?$/, `=s${AVATAR_SIZE}-c`);
    return url.href;
}
