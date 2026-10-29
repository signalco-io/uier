import { createHash } from 'node:crypto';

// Fixed bytes shared by the document and CSP. Never interpolate request values into this script.
export const sessionScript = `
window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || !/^https?:\\/\\//.test(event.origin)) return;
    const data = event.data;
    if (data?.type !== 'uier:session' || typeof data.id !== 'string' || data.id.length > 128
        || typeof data.project !== 'string' || !/^(?:[a-z0-9]{12}|[A-Za-z0-9_-]{21})$/.test(data.project)) return;
    try {
        const response = await fetch('/api/review/' + data.project + '/sso', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: event.origin })
        });
        const result = response.ok && response.status !== 204 ? await response.json() : undefined;
        window.parent.postMessage({ type: 'uier:session-result', id: data.id, token: result?.token }, event.origin);
    } catch {
        window.parent.postMessage({ type: 'uier:session-result', id: data.id }, event.origin);
    }
});
window.parent.postMessage({ type: 'uier:session-ready' }, '*');
`;

export const sessionScriptHash = `'sha256-${createHash('sha256').update(sessionScript).digest('base64')}'`;

export const sessionContentSecurityPolicy = `default-src 'none'; script-src ${sessionScriptHash}; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'none'`;
