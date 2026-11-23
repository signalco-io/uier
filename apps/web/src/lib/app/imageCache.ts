import { useEffect, useSyncExternalStore } from 'react';
import { cacheDelete, cacheEntries, cacheGet, cacheSet } from './browserCache';
import { blobIconTile, type IconTile } from './iconTile';

/**
 * Copies of the app's own small images (project favicons, workspace logos) in this browser (`browserCache`), keyed
 * by their URL. Their responses are private and vary by Cookie, so the HTTP cache misses them after every account
 * or workspace switch (each changes a cookie) and a favicon goes back to the server, which may have to fetch it
 * from the site again. A copy draws in the image's place until the image loads; one older than a day is refetched
 * in the background. Only URLs the server rendered for the person reach here, and only bytes it sent as an image.
 */
/**
 * `source` is the URL the bytes came from (the screen's density variant), which a refresh asks for again; `tile` is
 * the tile the image draws on (`iconTile`), decided once with the bytes so the copy draws on the image's tile
 */
type StoredImage = { blob: Blob; savedAt: number; source: string; tile?: IconTile };

const PREFIX = 'image:';
const REFRESH_AFTER = 24 * 60 * 60 * 1000;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** URL → object URL of its copy, for this document */
const objectUrls = new Map<string, string>();
/** URL → when its copy was saved and where from */
const stored = new Map<string, Pick<StoredImage, 'savedAt' | 'source'>>();
/** Object URL of a copy → its tile, so a copy that keeps drawing keeps its own */
const tiles = new Map<string, IconTile>();
/** URLs already looked up in the database this document (found or not) */
const looked = new Set<string>();
const refreshed = new Set<string>();
const remembering = new Set<string>();
const listeners = new Set<() => void>();
let loadingAll: Promise<void> | undefined;

function notify() {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function isFresh(image: StoredImage | undefined): image is StoredImage {
    return Boolean(image?.blob) && Date.now() - image!.savedAt <= MAX_AGE;
}

/**
 * A copy saved before tiles were kept is measured before it draws. It is not written back (a sign-out may have
 * removed it meanwhile); its daily refresh saves the tile.
 */
async function withTile(image: StoredImage) {
    return image.tile ? image : { ...image, tile: await blobIconTile(image.blob) };
}

/** Keeps a fresh copy for this document */
function take(url: string, image: StoredImage) {
    // The previous object URL is not revoked: an image may still be drawing it
    if (!objectUrls.has(url)) {
        const objectUrl = URL.createObjectURL(image.blob);
        objectUrls.set(url, objectUrl);
        tiles.set(objectUrl, image.tile ?? 'light');
    }
    stored.set(url, { savedAt: image.savedAt, source: image.source ?? url });
}

/** A copy older than a day is refetched once per document, in the background */
function refreshIfOld(url: string) {
    const image = stored.get(url);
    if (image && Date.now() - image.savedAt > REFRESH_AFTER && !refreshed.has(url)) {
        refreshed.add(url);
        void rememberImage(url, image.source, { refresh: true });
    }
}

/** Every copy at once, before the shell's copy draws (`CachedShell`), so its favicons are there in its first paint */
export function loadAllCachedImages() {
    loadingAll ??= (async () => {
        const stale: string[] = [];
        const fresh: Promise<void>[] = [];
        for (const [key, image] of await cacheEntries<StoredImage>(PREFIX)) {
            const url = key.slice(PREFIX.length);
            looked.add(url);
            if (isFresh(image))
                fresh.push(withTile(image).then(measured => take(url, measured)));
            else
                stale.push(key);
        }
        await Promise.all(fresh);
        notify();
        await cacheDelete(stale);
    })();
    return loadingAll;
}

/** Looks the URL up once per document */
export async function loadCachedImage(url: string) {
    if (!looked.has(url)) {
        looked.add(url);
        const image = await cacheGet<StoredImage>(`${PREFIX}${url}`);
        if (isFresh(image)) {
            take(url, await withTile(image));
            notify();
        }
        else if (image)
            await cacheDelete(`${PREFIX}${url}`);
    }
    refreshIfOld(url);
}

/**
 * Keeps a copy of `url` from `source` (the variant the screen's density drew). After an image loaded the browser
 * still has the response, so this reads its cache, not the network; `refresh` asks the server again. `tile` is the
 * one the loaded image measured (`measureIconTile`); without it the bytes are measured.
 */
export async function rememberImage(url: string, source = url, { refresh = false, tile }: { refresh?: boolean; tile?: IconTile } = {}) {
    if (remembering.has(url) || (!refresh && stored.has(url)))
        return;
    remembering.add(url);
    try {
        const response = await fetch(source, { cache: refresh ? 'no-cache' : 'force-cache', credentials: 'same-origin' });
        const blob = response.ok ? await response.blob() : undefined;
        if (blob?.type.startsWith('image/')) {
            const image = { blob, savedAt: Date.now(), source, tile: tile ?? await blobIconTile(blob) } satisfies StoredImage;
            await cacheSet(`${PREFIX}${url}`, image);
            // A copy that is drawing keeps drawing; marks that mount later in this document draw the new one
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.set(url, objectUrl);
            tiles.set(objectUrl, image.tile);
            stored.set(url, { savedAt: image.savedAt, source });
        }
        else if (refresh && response.status === 404) {
            // The site has no icon any more: stop drawing the old one
            objectUrls.delete(url);
            stored.delete(url);
            notify();
            await cacheDelete(`${PREFIX}${url}`);
        }
    } catch {
        // Offline or blocked: the copy (or the network image) stays
    } finally {
        remembering.delete(url);
    }
}

/**
 * The object URL of `url`'s copy, once it is known in this document. During hydration this is `undefined`, as on the
 * server, so the markup matches; the copy draws right after, where the image has not loaded yet.
 */
export function useCachedImage(url: string | undefined) {
    const copy = useSyncExternalStore(subscribe, () => (url ? objectUrls.get(url) : undefined), () => undefined);
    useEffect(() => {
        if (url)
            void loadCachedImage(url);
    }, [url]);
    return copy;
}

/** The tile a copy (an object URL from {@link useCachedImage}) draws on */
export function cachedImageTile(copy: string | undefined): IconTile | undefined {
    return copy === undefined ? undefined : tiles.get(copy) ?? 'light';
}

/** The density variant `<img srcset>` picks on this screen: 2× from a device pixel ratio above 1 */
export function screenDensity() {
    return typeof window !== 'undefined' && window.devicePixelRatio > 1 ? 2 : 1;
}
