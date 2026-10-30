import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

// A software authenticator for API tests: one P-256 credential with "none" attestation. Browser
// tests use Chromium's virtual authenticator instead.

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest());
const b64 = (data: Uint8Array | string) => isoBase64URL.fromBuffer(new Uint8Array(typeof data === 'string' ? isoUint8Array.fromUTF8String(data) : data));

export type Ceremony = {
    origin: string;
    rpId: string;
    /** User verification (default true) */
    verified?: boolean;
    /** Override the signature counter of this response */
    counter?: number;
};

export function softAuthenticator({ synced = false, countUp = true }: { synced?: boolean; countUp?: boolean } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cosePublicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
        [1, 2], [3, -7], [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)]
    ]));
    const rawId = new Uint8Array(randomBytes(16));
    const id = isoBase64URL.fromBuffer(rawId);
    let counter = 0;
    let userHandle: string | undefined;

    function authenticatorData(rpId: string, flags: number, signCount: number, attested?: Uint8Array<ArrayBuffer>) {
        const count = new Uint8Array(4);
        new DataView(count.buffer).setUint32(0, signCount);
        return isoUint8Array.concat([sha256(rpId), new Uint8Array([flags | (synced ? BE | BS : 0)]), count, ...(attested ? [attested] : [])]);
    }

    function flags(verified = true) {
        return UP | (verified ? UV : 0);
    }

    return {
        id,
        get counter() { return counter; },
        register(options: { challenge: string; user: { id: string } }, ceremony: Ceremony): RegistrationResponseJSON {
            userHandle = options.user.id;
            const length = new Uint8Array([rawId.length >> 8, rawId.length & 0xff]);
            const attested = isoUint8Array.concat([new Uint8Array(16), length, rawId, cosePublicKey]);
            const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ceremony.origin, crossOrigin: false });
            const attestationObject = isoCBOR.encode(new Map<string, unknown>([
                ['fmt', 'none'], ['attStmt', new Map()],
                ['authData', authenticatorData(ceremony.rpId, flags(ceremony.verified) | AT, ceremony.counter ?? counter, attested)]
            ]) as never);
            return {
                id, rawId: id, type: 'public-key',
                response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
                clientExtensionResults: {}
            };
        },
        authenticate(options: { challenge: string }, ceremony: Ceremony & { userHandle?: string | null }): AuthenticationResponseJSON {
            if (ceremony.counter === undefined && countUp)
                counter++;
            const authData = authenticatorData(ceremony.rpId, flags(ceremony.verified), ceremony.counter ?? counter);
            const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ceremony.origin, crossOrigin: false });
            const signature = sign('sha256', isoUint8Array.concat([authData, sha256(clientDataJSON)]), privateKey);
            const handle = ceremony.userHandle === null ? undefined : ceremony.userHandle ?? userHandle;
            return {
                id, rawId: id, type: 'public-key',
                response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(new Uint8Array(signature)), ...(handle ? { userHandle: handle } : {}) },
                clientExtensionResults: {}
            };
        }
    };
}
