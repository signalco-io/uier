import { consume, APP_COUNTERS_PARTITION } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { z } from 'zod';
import { apiErrors } from '../comments/http';
import { getAppStore } from '../app/store';
import type { AppDoc } from '../app/model';
import { getUser } from '../app/users';
import { randomToken, sha256Hex, signToken, verifyToken } from '../app/tokens';

export const extensionSessionSeconds = 8 * 60 * 60;
export const extensionScopeSeconds = 5 * 60;
import { extensionClientIds } from './config';
export { extensionClientIds } from './config';
export const authorizeSchema = z.object({
    clientId: z.string().regex(/^[a-p]{32}$/),
    redirectUri: z.string().max(256),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});
export type Authorization = z.infer<typeof authorizeSchema>;
export function validateAuthorization(input: unknown) {
    const parsed = authorizeSchema.safeParse(input);
    if (!parsed.success) throw apiErrors.invalidRequest('Invalid extension authorization.');
    const data = parsed.data;
    if (!extensionClientIds().includes(data.clientId) || data.redirectUri !== `https://${data.clientId}.chromiumapp.org/uier`)
        throw apiErrors.forbidden('This extension client is not enabled.');
    return data;
}
type Code = AppDoc & Authorization & { type: 'extension-code'; userId: string; expiresAt: number; ttl: number };
type Session = AppDoc & { type: 'extension-session'; userId: string; clientId: string; expiresAt: number; ttl: number };
type SessionToken = { id: string; clientId: string; userId: string };
export async function issueExtensionCode(userId: string, input: unknown) {
    const data = validateAuthorization(input);
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, { key: `extension-sign-in:${userId}`, limit: 30, windowSeconds: 3600, reason: 'too_fast', message: 'Too many extension sign-ins. Try again later.' });
    const code = randomToken();
    const hash = sha256Hex(code);
    await getAppStore().create<Code>({ ...data, type: 'extension-code', id: hash, pk: `extension-code:${hash}`, userId, expiresAt: Date.now() + 60_000, ttl: 60 });
    const target = new URL(data.redirectUri);
    target.searchParams.set('state', data.state);
    target.searchParams.set('code', code);
    return target.href;
}
const exchangeSchema = authorizeSchema.omit({ state: true, challenge: true }).extend({
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});
export async function exchangeExtensionCode(input: unknown) {
    const parsed = exchangeSchema.safeParse(input);
    if (!parsed.success) throw apiErrors.forbidden('Invalid extension handoff.');
    const { code, verifier, clientId, redirectUri } = parsed.data;
    const hash = sha256Hex(code);
    const entry = (await getAppStore().get<Code>(`extension-code:${hash}`, hash))?.doc;
    const challenge = Buffer.from(sha256Hex(verifier), 'hex').toString('base64url');
    if (!entry || entry.expiresAt <= Date.now() || entry.clientId !== clientId || entry.redirectUri !== redirectUri
        || entry.challenge !== challenge || !extensionClientIds().includes(clientId)
        || !await getUser(entry.userId) || !await getAppStore().delete(entry.pk, entry.id))
        throw apiErrors.forbidden('This extension handoff has expired or was already used.');
    const id = sha256Hex(randomToken());
    const expiresAt = Date.now() + extensionSessionSeconds * 1000;
    await getAppStore().create<Session>({ type: 'extension-session', id, pk: `extension-session:${id}`, userId: entry.userId, clientId, expiresAt, ttl: extensionSessionSeconds });
    return { token: signToken<SessionToken>('extension-session', { id, userId: entry.userId, clientId }, extensionSessionSeconds), expiresAt };
}
function bearer(request: Request) { return request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]; }
export async function loadExtensionSession(value: SessionToken | null) {
    if (!value || !extensionClientIds().includes(value.clientId)) throw apiErrors.signInRequired();
    const session = (await getAppStore().get<Session>(`extension-session:${value.id}`, value.id))?.doc;
    if (!session || session.expiresAt <= Date.now() || session.userId !== value.userId || session.clientId !== value.clientId || !await getUser(session.userId))
        throw apiErrors.signInRequired();
    return session;
}
export async function extensionSession(request: Request) {
    return loadExtensionSession(verifyToken<SessionToken>('extension-session', bearer(request)));
}
export type Scope = SessionToken & { projectId: string; origin: string };
export function scopeToken(session: Session, projectId: string, origin: string) {
    return { token: signToken<Scope>('extension-review-v1', { id: session.id, userId: session.userId, clientId: session.clientId, projectId, origin }, extensionScopeSeconds), expiresAt: Date.now() + extensionScopeSeconds * 1000 };
}
export function readScope(request: Request) {
    const scope = verifyToken<Scope>('extension-review-v1', bearer(request));
    if (!scope) throw apiErrors.signInRequired();
    return scope;
}
