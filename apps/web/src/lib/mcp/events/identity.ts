import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { keyedHash } from '../../comments/environment';

/*
 * The server's identity toward webhook endpoints (SEP-3415, optional): beside the HMAC of the
 * subscription's own secret, every request carries an ed25519 signature (Standard Webhooks `v1a,`).
 * The HMAC says "for a subscription this endpoint made"; this one says which server sent it, so a
 * gateway can allow known servers and stays protected if a subscription secret leaks. The public key
 * is published on the Server Card (`serverCard.ts`), an origin the client already trusts, never in a
 * delivery. The key is derived from the server secret, which the app and the scheduled worker both
 * have: nothing else is stored, and it changes only when that secret does.
 */

type SigningKey = { seed: string; privateKey: KeyObject; jwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; use: 'sig'; alg: 'EdDSA' } };
/** The DER prefix of a PKCS #8 ed25519 private key; the 32-byte seed follows. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
let current: SigningKey | undefined;

function signingKey(): SigningKey {
    const seed = keyedHash('mcp-event-signing-key', 'v1');
    if (current?.seed === seed) return current;
    const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
    const x = String(createPublicKey(privateKey).export({ format: 'jwk' }).x);
    current = { seed, privateKey, jwk: { kty: 'OKP', crv: 'Ed25519', x, kid: createHash('sha256').update(x).digest('base64url').slice(0, 16), use: 'sig', alg: 'EdDSA' } };
    return current;
}

/** `v1a,` and the base64 ed25519 signature of `id.timestamp.body`, the same content the HMAC covers. */
export function serverSignature(webhookId: string, timestamp: number, body: string) {
    return `v1a,${sign(null, Buffer.from(`${webhookId}.${timestamp}.${body}`), signingKey().privateKey).toString('base64')}`;
}

/** The public key as a JWK set, for the Server Card. */
export function webhookSigningKeys() {
    return { keys: [signingKey().jwk] };
}
