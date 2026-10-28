import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isLocalRuntime } from '../comments/environment';

/** Keys are canonical base64-encoded 32-byte values. Only the current key encrypts new values. */
export type SecretKeyConfig = {
    key?: string;
    keyId?: string;
    previousKeys?: Readonly<Record<string, string>>;
};

/** Every component is authenticated, including absent optional fields. Never reuse a subject for another grant. */
export type SecretContext = {
    provider: string;
    workspaceId: string;
    subjectId: string;
    field: string;
    userId?: string;
    projectId?: string;
};

export class IntegrationSecretError extends Error {
    constructor(public readonly code: 'invalid_key' | 'key_unavailable' | 'invalid_context' | 'invalid_secret') {
        super('The integration credential could not be read or stored.');
        this.name = 'IntegrationSecretError';
    }
}

const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_SECRET_BYTES = 64 * 1024;

function keyId(config: SecretKeyConfig) {
    const id = config.keyId ?? 'k1';
    if (!keyIdPattern.test(id)) throw new IntegrationSecretError('invalid_key');
    return id;
}

function decodeKey(value: string) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new IntegrationSecretError('invalid_key');
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32 || key.toString('base64') !== value) throw new IntegrationSecretError('invalid_key');
    return key;
}

function encryptionKey(config: SecretKeyConfig, id: string) {
    if (id === keyId(config)) {
        if (config.key) return decodeKey(config.key);
        if (isLocalRuntime()) return createHash('sha256').update('uier-integration-local-development-v1').digest();
        throw new IntegrationSecretError('key_unavailable');
    }
    const previous = config.previousKeys?.[id];
    if (previous) return decodeKey(previous);
    throw new IntegrationSecretError('key_unavailable');
}

function aad(context: SecretContext) {
    const values = [context.provider, context.workspaceId, context.subjectId, context.field, context.userId ?? null, context.projectId ?? null];
    if (!providerPattern.test(context.provider) || values.some(value => value !== null
        && (typeof value !== 'string' || !value.length || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))))
        throw new IntegrationSecretError('invalid_context');
    // A structured tuple avoids ambiguous delimiter concatenation and binds optional fields too.
    return Buffer.from(JSON.stringify(['uier-integration-secret', 1, ...values]));
}

function decodePart(value: string, expectedLength?: number) {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new IntegrationSecretError('invalid_secret');
    const result = Buffer.from(value, 'base64url');
    if (result.toString('base64url') !== value || (expectedLength !== undefined && result.length !== expectedLength))
        throw new IntegrationSecretError('invalid_secret');
    return result;
}

/** Configuration check for server-only provider gates. Does not expose a key or log a value. */
export function isSecretKeyConfigured(config: SecretKeyConfig = {}) {
    try {
        encryptionKey(config, keyId(config));
        return true;
    } catch {
        return false;
    }
}

export function encryptSecret(value: string, context: SecretContext, config: SecretKeyConfig = {}) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_SECRET_BYTES) throw new IntegrationSecretError('invalid_secret');
    const id = keyId(config);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(config, id), iv);
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', id, iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptSecret(value: string, context: SecretContext, config: SecretKeyConfig = {}) {
    if (typeof value !== 'string' || value.length > MAX_SECRET_BYTES * 2) throw new IntegrationSecretError('invalid_secret');
    const [version, id, iv, ciphertext, tag, ...extra] = value.split('.');
    if (version !== 'v1' || !id || !keyIdPattern.test(id) || iv === undefined || ciphertext === undefined || tag === undefined || extra.length)
        throw new IntegrationSecretError('invalid_secret');
    const key = encryptionKey(config, id);
    const additionalData = aad(context);
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, decodePart(iv, 12));
        decipher.setAAD(additionalData);
        decipher.setAuthTag(decodePart(tag, 16));
        const plaintext = Buffer.concat([decipher.update(decodePart(ciphertext)), decipher.final()]);
        if (plaintext.length > MAX_SECRET_BYTES) throw new IntegrationSecretError('invalid_secret');
        return plaintext.toString('utf8');
    } catch {
        // Do not propagate crypto errors, input values, ciphertext or causes into action logging.
        throw new IntegrationSecretError('invalid_secret');
    }
}
