import { createHash } from 'node:crypto';
import { type AppDoc, userPk } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';
import { isRandomToken, randomToken, sha256Hex } from '../app/tokens';
import { decryptSecret, encryptSecret, type SecretContext, type SecretKeyConfig } from './secrets';

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export type OauthBinding = {
    provider: string;
    userId: string;
    workspaceId: string;
    projectId: string;
    /** Separates e.g. GitHub installation setup from user authorization. */
    intent?: string;
};

export type IntegrationOauthState = AppDoc & {
    provider: string;
    userId: string;
    workspaceId: string;
    projectId: string;
    intent: string;
    stateHash: string;
    createdAt: string;
    expiresAt: string;
    verifier?: string;
    /** Bounded non-secret provider ids only. Never reflected in the outbound state value. */
    metadata?: Record<string, string>;
    consumedAt?: string;
    ttl: number;
};

export type CreatedOauthState = {
    state: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256';
};

export type ConsumedOauthState = OauthBinding & {
    id: string;
    intent: string;
    createdAt: string;
    expiresAt: string;
    metadata?: Record<string, string>;
    codeVerifier?: string;
};

export class OauthStateError extends Error {
    constructor(public readonly code: 'invalid_binding' | 'state_conflict') {
        super('The integration connection could not be started. Start again from project settings.');
        this.name = 'OauthStateError';
    }
}

function bindingIntent(binding: OauthBinding) {
    const intent = binding.intent ?? 'connect';
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(binding.provider) || !/^[a-z][a-z0-9-]{0,31}$/.test(intent)
        || [binding.userId, binding.workspaceId, binding.projectId].some(value => !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)))
        throw new OauthStateError('invalid_binding');
    return intent;
}

function safeMetadata(metadata: Record<string, string> | undefined) {
    if (metadata === undefined) return undefined;
    if (Object.keys(metadata).length > 8 || Object.entries(metadata).some(([key, value]) =>
        !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key) || typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)))
        throw new OauthStateError('invalid_binding');
    return { ...metadata };
}

function verifierContext(doc: Pick<IntegrationOauthState, 'provider' | 'workspaceId' | 'projectId' | 'userId' | 'id' | 'stateHash'>): SecretContext {
    return { provider: doc.provider, workspaceId: doc.workspaceId, projectId: doc.projectId, userId: doc.userId,
        subjectId: `oauth:${doc.id}:${doc.stateHash}`, field: 'pkce' };
}

/** One active flow per provider/user/workspace/project/intent. A newer start invalidates the old state. */
export async function createOauthState(input: OauthBinding & { pkce?: boolean; key?: SecretKeyConfig; metadata?: Record<string, string> },
    store: AppStore = getAppStore(), now = Date.now()): Promise<CreatedOauthState> {
    const intent = bindingIntent(input);
    const state = randomToken();
    const verifier = input.pkce === false ? undefined : randomToken();
    const doc: IntegrationOauthState = {
        type: `${input.provider}-oauth-state`, pk: userPk(input.userId),
        id: `oauth_${sha256Hex(JSON.stringify([input.provider, input.userId, input.workspaceId, input.projectId, intent]))}`,
        provider: input.provider, userId: input.userId, workspaceId: input.workspaceId, projectId: input.projectId, intent,
        stateHash: sha256Hex(state), createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + OAUTH_STATE_TTL_SECONDS * 1000).toISOString(), ttl: OAUTH_STATE_TTL_SECONDS,
        metadata: safeMetadata(input.metadata)
    };
    if (verifier !== undefined) doc.verifier = encryptSecret(verifier, verifierContext(doc), input.key);
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get<IntegrationOauthState>(doc.pk, doc.id);
        if (!current ? await store.create(doc) : await store.replace(doc, current.etag) === 'ok') {
            return verifier === undefined ? { state } : {
                state, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256'
            };
        }
    }
    throw new OauthStateError('state_conflict');
}

/**
 * Atomically consumes the state before either denial handling or token exchange. The scrubbed receipt
 * stays until TTL instead of using an unconditional delete that could remove a concurrently restarted flow.
 */
export async function consumeOauthState(input: {
    provider: string;
    userId: string;
    state: unknown;
    key?: SecretKeyConfig;
    expected?: Partial<Pick<OauthBinding, 'workspaceId' | 'projectId' | 'intent'>>;
}, store: AppStore = getAppStore(), now = Date.now()): Promise<ConsumedOauthState | null> {
    if (!isRandomToken(input.state) || !/^[a-z][a-z0-9-]{0,31}$/.test(input.provider) || !input.userId) return null;
    const stateHash = sha256Hex(input.state);
    const candidates = await store.query<IntegrationOauthState>({ type: `${input.provider}-oauth-state`, pk: userPk(input.userId),
        where: { provider: input.provider, stateHash } });
    if (candidates.length !== 1) return null;
    const stored = await store.get<IntegrationOauthState>(userPk(input.userId), candidates[0]!.id);
    if (!stored || stored.doc.type !== `${input.provider}-oauth-state` || stored.doc.provider !== input.provider
        || stored.doc.userId !== input.userId || stored.doc.stateHash !== stateHash || stored.doc.consumedAt) return null;
    const doc = stored.doc;
    const { verifier: _verifier, ...receipt } = doc;
    if (await store.replace({ ...receipt, consumedAt: new Date(now).toISOString() }, stored.etag) !== 'ok') return null;
    const createdAt = Date.parse(doc.createdAt);
    const expiresAt = Date.parse(doc.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now || expiresAt <= now
        || expiresAt - createdAt > OAUTH_STATE_TTL_SECONDS * 1000
        || Object.entries(input.expected ?? {}).some(([key, value]) => value !== undefined && doc[key as keyof OauthBinding] !== value)) return null;
    let codeVerifier: string | undefined;
    if (doc.verifier !== undefined) {
        try { codeVerifier = decryptSecret(doc.verifier, verifierContext(doc), input.key); }
        catch { return null; }
    }
    return { id: doc.id, provider: doc.provider, userId: doc.userId, workspaceId: doc.workspaceId, projectId: doc.projectId,
        intent: doc.intent, createdAt: doc.createdAt, expiresAt: doc.expiresAt, metadata: doc.metadata, codeVerifier };
}
