export type ExtensionClient = { id: string; browser: 'chrome' | 'firefox'; redirectUri: string };
export const extensionClientIdPattern = /^[A-Za-z0-9@._{}-]{1,256}$/;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const dynamicOrigin = new RegExp(`^moz-extension:\\/\\/${uuid}$`, 'i');

/** Registration is explicit. A malformed or ambiguous additional registration fails closed. */
export function extensionClients(): ExtensionClient[] {
    const chrome = (process.env.UIER_EXTENSION_CLIENT_IDS ?? '').split(',').map(s => s.trim())
        .filter(s => /^[a-p]{32}$/.test(s)).map(id => ({ id, browser: 'chrome' as const, redirectUri: `https://${id}.chromiumapp.org/uier` }));
    let additional: unknown;
    try { additional = JSON.parse(process.env.UIER_EXTENSION_CLIENTS || '[]'); }
    catch { return chrome; }
    if (!Array.isArray(additional) || additional.length > 100) return chrome;
    const ids = new Set(chrome.map(client => client.id));
    const clients: ExtensionClient[] = [];
    for (const input of additional) {
        if (!input || typeof input !== 'object') return chrome;
        const value = input as Record<string, unknown>;
        if (typeof value.id !== 'string' || !extensionClientIdPattern.test(value.id)
            || ids.has(value.id) || value.browser !== 'firefox' || typeof value.redirectUri !== 'string'
            || value.redirectUri.length > 512 || !validRedirect(value.redirectUri)) return chrome;
        ids.add(value.id);
        clients.push({ id: value.id, browser: value.browser, redirectUri: value.redirectUri });
    }
    return [...chrome, ...clients];
}

function validRedirect(value: string) {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash || url.href !== value) return false;
        return url.protocol === 'https:' && /^[a-z0-9]+\.extensions\.allizom\.org$/.test(url.hostname) && url.pathname === '/' && !url.port;
    } catch { return false; }
}

export function extensionClientIds() { return extensionClients().map(client => client.id); }
export function extensionClient(id: string) { return extensionClients().find(client => client.id === id); }

export function extensionClientOrigin(client: ExtensionClient, origin?: string): string | undefined {
    if (client.browser === 'chrome') {
        const expected = `chrome-extension://${client.id}`;
        return origin === undefined || origin === expected ? expected : undefined;
    }
    const match = origin && dynamicOrigin.exec(origin);
    return match ? origin : undefined;
}

/** Only extension schemes for explicitly enabled browser families get CORS transport. */
export function isExtensionTransportOrigin(origin: string | null) {
    if (!origin) return false;
    return extensionClients().some(client => extensionClientOrigin(client, origin) !== undefined);
}

/** Dynamic browser origins get an exact, per-request frame ancestor, never a scheme wildcard. */
export function extensionFrameAncestors(url: URL) {
    const id = url.searchParams.get('clientId'), origin = url.searchParams.get('extensionOrigin');
    if (id !== null || origin !== null) {
        const client = id && extensionClient(id);
        const allowed = client && origin && extensionClientOrigin(client, origin);
        return allowed ? [allowed] : [];
    }
    // Installed Chromium packages before the shared build don't send helper parameters.
    return extensionClients().filter(client => client.browser === 'chrome').map(client => `chrome-extension://${client.id}`);
}
