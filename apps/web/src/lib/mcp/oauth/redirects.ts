const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(value: string) {
    try { return new URL(value); } catch { return null; }
}

export function isLoopbackRedirect(url: URL) {
    return url.protocol === 'http:' && loopbackHosts.has(url.hostname);
}

/**
 * Redirect URIs uier accepts: HTTPS, or HTTP on a loopback host (RFC 8252). No custom schemes,
 * fragments, user information or wildcard hosts.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 512) return false;
    const url = parse(value);
    if (!url || url.hash || value.includes('#') || url.username || url.password || url.hostname.includes('*')) return false;
    return url.protocol === 'https:' || isLoopbackRedirect(url);
}

/**
 * HTTPS redirect URIs match exactly. Loopback URIs match with the port ignored and scheme, host,
 * path and query compared exactly (clients listen on an ephemeral port).
 */
export function redirectUriMatches(registered: string, requested: string) {
    if (!isAllowedRedirectUri(requested)) return false;
    if (registered === requested) return true;
    const a = parse(registered);
    const b = parse(requested);
    if (!a || !b || !isLoopbackRedirect(a) || !isLoopbackRedirect(b)) return false;
    return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

/** The host a client sends people back to, or `null` for this computer */
export function redirectHost(redirectUri: string) {
    const url = parse(redirectUri);
    return !url || isLoopbackRedirect(url) ? null : url.host;
}
