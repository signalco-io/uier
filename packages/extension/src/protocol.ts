/** Versioned, closed worker message envelope. Authorization also binds the browser sender. */
export type CaptureRegion = { left: number; top: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
export type WorkerMessage =
    | { type: 'state' | 'sign-in' | 'sign-out' | 'drafts' | 'update' | 'install-update' }
    | { type: 'exit'; tabId?: number }
    | { type: 'start'; tabId: number; projectId: string; publicId: string }
    | { type: 'draft'; key: string; value: string | null }
    | { type: 'capture'; region: CaptureRegion }
    | { type: 'request'; url: string; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }
    | { type: 'image'; url: string }
    | { type: 'helper-job'; nonce: string }
    | { type: 'verified'; nonce: string; proof: { token: string; expiresAt: number } | null };

export function parseWorkerMessage(input: unknown): WorkerMessage {
    const fail = (): never => { throw new Error('Unsupported extension message.'); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
    const msg = input as Record<string, unknown>;
    const keys = (...allowed: string[]) => Object.keys(msg).every(key => key === 'type' || allowed.includes(key));
    const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
    const tab = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    let valid = false;
    switch (msg.type) {
        case 'state': case 'sign-in': case 'sign-out': case 'drafts': case 'update': case 'install-update': valid = keys(); break;
        case 'exit': valid = keys('tabId') && (msg.tabId === undefined || tab(msg.tabId)); break;
        case 'start': valid = keys('tabId', 'projectId', 'publicId') && tab(msg.tabId) && text(msg.projectId, 128) && text(msg.publicId, 128); break;
        case 'draft': valid = keys('key', 'value') && text(msg.key, 2047) && msg.key.startsWith('uier:draft:v1:') && (msg.value === null || (text(msg.value, 64_000) && !msg.value.includes('data:image/'))); break;
        case 'image': valid = keys('url') && text(msg.url, 8192); break;
        case 'request': valid = keys('url', 'method', 'body') && text(msg.url, 8192) && (msg.method === undefined || ['GET', 'POST', 'PATCH', 'DELETE'].includes(String(msg.method))) && JSON.stringify(msg.body ?? null).length <= 1_000_000; break;
        case 'helper-job': valid = keys('nonce') && typeof msg.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(msg.nonce); break;
        case 'verified': {
            const proof = msg.proof as Record<string, unknown> | null;
            valid = keys('nonce', 'proof') && typeof msg.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(msg.nonce) && (proof === null || (!!proof && Object.keys(proof).every(key => ['token', 'expiresAt'].includes(key)) && text(proof.token, 2047) && typeof proof.expiresAt === 'number' && Number.isFinite(proof.expiresAt)));
            break;
        }
        case 'capture': {
            const region = msg.region as Record<string, unknown> | undefined;
            const fields = ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight'];
            valid = keys('region') && !!region && fields.every(key => typeof region[key] === 'number' && Number.isFinite(region[key])) && Object.keys(region).length === fields.length;
            break;
        }
    }
    if (!valid) return fail();
    return input as WorkerMessage;
}
