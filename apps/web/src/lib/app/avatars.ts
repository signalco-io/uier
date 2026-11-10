import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { KnownPageLinks } from '../../knownPages';
import { getAppStore, type AppMutation } from './store';
import { avatarDocId, userPk, type AvatarSource, type DbUser, type DbUserAvatar } from './model';
import { getUser } from './users';
import { AVATAR_SIZE, AVATAR_TYPE_ERROR, avatarInputTypes, MAX_AVATAR_UPLOAD_BYTES } from './avatarLimits';

export { AVATAR_SIZE, avatarInputTypes, MAX_AVATAR_UPLOAD_BYTES };
/** Pictures fetched from a sign-in provider */
export const MAX_PROVIDER_PICTURE_BYTES = 2 * 1024 * 1024;
export const PROVIDER_PICTURE_TIMEOUT_MS = 5_000;
/**
 * About 24 MP (a 24 MP phone photo, 5712 × 4284, is 24.5 MP): decoding stops before a larger image
 * is expanded in memory for what becomes at most 256 px
 */
const MAX_INPUT_PIXELS = 25_000_000;
/** A 256 px WebP is far smaller; the cap keeps documents small whatever the input */
const MAX_STORED_BYTES = 96 * 1024;
const versionPattern = /^[A-Za-z0-9_-]{21}$/;

export const avatarErrors = {
    empty: 'Choose an image.',
    tooLarge: (bytes: number) => `Use an image up to ${Math.floor(bytes / (1024 * 1024))} MB.`,
    type: AVATAR_TYPE_ERROR,
    unreadable: 'This image could not be read. Try another one.'
} as const;

export type AvatarImage = { data: Buffer; size: number };

/** The format from the file's first bytes, never from its name or declared type */
function sniffImage(data: Buffer) {
    if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
    if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString('latin1', 0, 6))) return 'gif';
    return null;
}

/**
 * Decodes untrusted bytes and re-encodes only pixels: the first frame, upright, cropped to the
 * centre square and scaled down to {@link AVATAR_SIZE} (never up), as WebP without metadata.
 * An error message when the bytes are not a PNG, JPEG, WebP or GIF image within the limits.
 */
export async function normalizeAvatar(input: Buffer, maxBytes = MAX_AVATAR_UPLOAD_BYTES): Promise<AvatarImage | string> {
    if (input.length === 0) return avatarErrors.empty;
    if (input.length > maxBytes) return avatarErrors.tooLarge(maxBytes);
    if (!sniffImage(input)) return avatarErrors.type;
    const decode = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1, failOn: 'error' });
    try {
        const { width, height } = await decode().metadata();
        if (!width || !height) return avatarErrors.unreadable;
        // The shorter side, whichever way the photo is turned
        const side = Math.min(AVATAR_SIZE, width, height);
        for (const quality of [82, 60]) {
            const { data, info } = await decode().autoOrient()
                .resize(side, side, { fit: 'cover', position: 'centre' })
                .webp({ quality })
                .toBuffer({ resolveWithObject: true });
            if (info.width !== info.height || info.width < 1) return avatarErrors.unreadable;
            if (data.length <= MAX_STORED_BYTES) return { data, size: info.width };
        }
        return avatarErrors.unreadable;
    } catch {
        return avatarErrors.unreadable;
    }
}

export function isAvatarVersion(value: unknown): value is string {
    return typeof value === 'string' && versionPattern.test(value);
}

/** The picture's address for the app, or `undefined` for initials */
export function avatarUrl(user: Pick<DbUser, 'id' | 'avatar'> | null | undefined) {
    return user?.avatar && isAvatarVersion(user.avatar.version) ? KnownPageLinks.avatar(user.id, user.avatar.version) : undefined;
}

/** The current picture of this version, or `null` (replaced, removed or never existed) */
export async function getAvatarImage(userId: string, version: string) {
    if (!isAvatarVersion(version)) return null;
    const doc = (await getAppStore().get<DbUserAvatar>(userPk(userId), avatarDocId(version)))?.doc;
    return doc?.type === 'user-avatar' && doc.userId === userId ? doc : null;
}

export type SaveAvatarResult = { result: 'saved'; user: DbUser } | { result: 'kept' | 'not_found' };

/**
 * Sets the user's picture: the new image, the user's reference to it and the deletion of the
 * previous image are one batch in the user's partition, so no reference points to a missing image
 * and no old image stays behind. `keepExisting` (a provider's picture) leaves any picture in place.
 */
export async function saveUserAvatar(userId: string, image: AvatarImage, source: AvatarSource, { keepExisting = false } = {}): Promise<SaveAvatarResult> {
    const store = getAppStore();
    const pk = userPk(userId);
    for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await store.get<DbUser>(pk, userId);
        if (!stored) return { result: 'not_found' };
        if (keepExisting && stored.doc.avatar) return { result: 'kept' };
        const previous = stored.doc.avatar ? await store.get<DbUserAvatar>(pk, avatarDocId(stored.doc.avatar.version)) : null;
        const now = new Date().toISOString();
        const version = nanoid();
        const user: DbUser = { ...stored.doc, avatar: { version, source, updatedAt: now }, updatedAt: now };
        const avatar: DbUserAvatar = {
            type: 'user-avatar', id: avatarDocId(version), pk, userId, source, contentType: 'image/webp',
            size: image.size, bytes: image.data.length, data: image.data.toString('base64'), createdAt: now
        };
        const operations: AppMutation[] = [
            { kind: 'replace', doc: user, etag: stored.etag },
            { kind: 'create', doc: avatar },
            ...(previous ? [{ kind: 'delete', pk, id: previous.doc.id, etag: previous.etag } as const] : [])
        ];
        if (await store.transact(operations)) return { result: 'saved', user };
    }
    throw new Error('Could not save the profile picture');
}

/** Removes the user's picture (initials again); `false` when there was none */
export async function removeUserAvatar(userId: string) {
    const store = getAppStore();
    const pk = userPk(userId);
    for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await store.get<DbUser>(pk, userId);
        if (!stored?.doc.avatar) return false;
        const { avatar, ...rest } = stored.doc;
        const previous = await store.get<DbUserAvatar>(pk, avatarDocId(avatar.version));
        const operations: AppMutation[] = [
            { kind: 'replace', doc: { ...rest, updatedAt: new Date().toISOString() }, etag: stored.etag },
            ...(previous ? [{ kind: 'delete', pk, id: previous.doc.id, etag: previous.etag } as const] : [])
        ];
        if (await store.transact(operations)) return true;
    }
    throw new Error('Could not remove the profile picture');
}

/** Reads at most `maxBytes` of a response body, or `null` when it is longer */
async function readLimited(response: Response, maxBytes: number) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/**
 * A sign-in provider's picture, fetched on the server from the address the provider issued (the
 * caller checks it): no redirects, a timeout, an image type and a size limit, then normalized.
 * `null` on any failure; never logs the address or the credentials.
 */
export async function fetchProviderPicture(url: string, headers: Record<string, string> = {}): Promise<AvatarImage | null> {
    try {
        const response = await fetch(url, {
            redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(PROVIDER_PICTURE_TIMEOUT_MS),
            headers: { Accept: avatarInputTypes.join(', '), ...headers }
        });
        const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (!response.ok || !type || !(avatarInputTypes as readonly string[]).includes(type)) {
            await response.body?.cancel();
            return null;
        }
        const bytes = await readLimited(response, MAX_PROVIDER_PICTURE_BYTES);
        if (!bytes) return null;
        const image = await normalizeAvatar(bytes, MAX_PROVIDER_PICTURE_BYTES);
        return typeof image === 'string' ? null : image;
    } catch {
        return null;
    }
}

/** A normalized picture as it waits in a pending provider link (`DbGoogleLink`, `DbMicrosoftLink`) */
export type PendingPicture = { data: string; size: number };

export function pendingPicture(image: AvatarImage | null | undefined): PendingPicture | undefined {
    return image ? { data: image.data.toString('base64'), size: image.size } : undefined;
}

export function fromPendingPicture(picture: PendingPicture | undefined): AvatarImage | null {
    if (!picture || typeof picture.data !== 'string' || !Number.isInteger(picture.size) || picture.size < 1 || picture.size > AVATAR_SIZE)
        return null;
    const data = Buffer.from(picture.data, 'base64');
    return data.length > 0 && data.length <= MAX_STORED_BYTES ? { data, size: picture.size } : null;
}

/**
 * On a first sign-in with a provider or when connecting one: its picture becomes the user's
 * only while they have none. It never replaces a picture, uploaded or imported, and `load`
 * (the fetch) runs only when it could be used. Failures leave initials and never fail sign-in.
 */
export async function importProviderAvatar(userId: string, source: Exclude<AvatarSource, 'upload'>, load: () => Promise<AvatarImage | null>) {
    try {
        const user = await getUser(userId);
        if (!user || user.avatar) return;
        const image = await load();
        if (image) await saveUserAvatar(userId, image, source, { keepExisting: true });
    } catch {
        console.error('[avatars] Could not import the sign-in picture');
    }
}
