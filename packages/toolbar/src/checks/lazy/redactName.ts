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
        .replace(/[A-Za-z0-9+/_-]{16,}={0,2}/g, '…')
        .replace(/\d{8,}/g, '…')
        .replace(/[\r\n`]/g, ' ')
        .slice(0, 160);
}
