/** Shorten potentially identifying name segments before inventory, display or comment creation.
 * Auth formats are handled first: even short usernames and client/account IDs are private.
 * Apply before truncation so a long prefix cannot leave a partial identifier visible.
 */
export function redactName(name: string): string {
    return name
        .replace(/(CognitoIdentityServiceProvider\.)[^]+/i, '$1…')
        .replace(/[^]*?(-login\.(?:windows\.net|microsoftonline\.com)-)[^]*/i, '…$1…')
        .replace(/^(msal\.)[^]+/i, '$1…')
        .replace(/^(firebase:[^:]+:)[^]+/i, '$1…')
        .replace(/^(a0\.spajs\.txs\.)[^]+/i, '$1…')
        .replace(/^(@@auth0spajs@@|auth0)(?=[.:|])[^]+/i, '$1:…')
        .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*/gi, '…')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
        // Known analytics suffixes are identifiers even when shorter than the generic threshold.
        .replace(/^(_ga_|_hjSession(?:User)?_)([A-Za-z0-9]+)$/i, (_, prefix: string, suffix: string) =>
            /\d/.test(suffix) ? `${prefix}…` : `${prefix}${suffix}`)
        // Treat name separators as boundaries so readable prefixes survive. Long words alone
        // are useful cookie names; only mixed alphanumerics, hex or base64 syntax look opaque.
        .replace(/[A-Za-z0-9+/]{16,}={0,2}/g, segment =>
            /[a-z]/i.test(segment) && /\d/.test(segment)
                || /^[a-f0-9]{16,}$/i.test(segment) || /[+/=]/.test(segment) ? '…' : segment)
        .replace(/\d{8,}/g, '…')
        .replace(/[\r\n`]/g, ' ')
        .slice(0, 160);
}
