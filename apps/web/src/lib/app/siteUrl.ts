import { MAX_PROJECT_NAME_LENGTH } from './limits';

// Pure helpers for a project's site addresses, shared by the server (`projects.ts`) and the forms.

const MAX_URL_LENGTH = 512;

/**
 * A site URL as typed by a person: `example.com`, `https://staging.example.com/app/`. Returns the
 * normalized URL (origin plus path, no query, hash or trailing slash) or `null` when it is not a
 * web address. Schemeless localhost and loopback addresses default to HTTP; other sites use HTTPS.
 */
export function normalizeSiteUrl(input: string) {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH)
        return null;

    let url: URL;
    try {
        const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
        url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
        const hostname = url.hostname.replace(/\.$/, '');
        const loopback = hostname === 'localhost' || hostname.endsWith('.localhost')
            || /^127(?:\.\d+){3}$/.test(hostname) || hostname === '[::1]';
        // Reparse so an explicit port (including 443) survives the change of default scheme.
        if (!hasScheme && loopback)
            url = new URL(`http://${trimmed}`);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    if (url.username || url.password || !url.hostname)
        return null;
    // A host name with a dot (example.com), localhost, or an IP address
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('['))
        return null;

    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
}

/** `https://www.example.com/app` -> `example.com` */
export function defaultProjectName(url: string) {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '').slice(0, MAX_PROJECT_NAME_LENGTH);
}
