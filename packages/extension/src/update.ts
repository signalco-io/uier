import { browser } from './browser';
import { apiOrigin } from './environment';

/**
 * Store updates (docs/browser-extension.md, "Updates"). The browser checks the store every few
 * hours and installs a download once the extension is idle, which can wait for a browser restart.
 * uier reports the newest version on main. Only when it is newer than this package does the worker
 * ask the browser for an immediate check, the one use Chrome documents for requestUpdateCheck. The
 * popup offers a restart only after the browser has the update; the store may still be reviewing it.
 */
export type UpdateState = { version: string; ready?: string };
const checkedKey = 'update-checked-v1';
const readyKey = 'update-ready-v1';
/** At most one server and store check per browser session and hour */
export const updateCheckInterval = 60 * 60_000;
const versionPattern = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export function newerVersion(candidate: string, current: string) {
    const next = candidate.split('.').map(Number), installed = current.split('.').map(Number);
    for (let index = 0; index < Math.max(next.length, installed.length); index++) {
        const difference = (next[index] ?? 0) - (installed[index] ?? 0);
        if (difference) return difference > 0;
    }
    return false;
}

const installedVersion = () => browser.runtime.getManifest().version;
async function remember(version: string | undefined) {
    if (typeof version === 'string' && versionPattern.test(version) && newerVersion(version, installedVersion()))
        await browser.storage.session.set({ [readyKey]: version });
}

/** Register at worker start: the browser reports a download it could not install while uier ran. */
export function watchUpdates() {
    browser.runtime.onUpdateAvailable.addListener(details => { void remember(details?.version).catch(() => {}); });
}

/** The downloaded update waiting for a restart, if any. Session storage clears on every update. */
export async function readyUpdate() {
    const ready = (await browser.storage.session.get(readyKey))[readyKey];
    return typeof ready === 'string' && newerVersion(ready, installedVersion()) ? ready : undefined;
}

export async function updateState(now = Date.now()): Promise<UpdateState> {
    const version = installedVersion();
    const ready = await readyUpdate();
    if (ready) return { version, ready };
    const checked = (await browser.storage.session.get(checkedKey))[checkedKey];
    if (typeof checked === 'number' && checked <= now && now - checked < updateCheckInterval) return { version };
    // Record the attempt first, so failures and concurrent popups still check once per interval.
    await browser.storage.session.set({ [checkedKey]: now });
    const latest = await latestVersion();
    if (!latest || !newerVersion(latest, version)) return { version };
    const result = await browser.runtime.requestUpdateCheck().catch(() => undefined) as
        (chrome.runtime.RequestUpdateCheckResult & { details?: { version?: string } }) | undefined;
    // Chromium resolves after downloading the update. Firefox nests the version in details.
    if (result?.status !== 'update_available') return { version };
    await remember(result.version ?? result.details?.version ?? latest);
    const downloaded = await readyUpdate();
    return downloaded ? { version, ready: downloaded } : { version };
}

async function latestVersion() {
    try {
        const response = await fetch(`${apiOrigin}/api/extension/version`, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
        if (!response.ok) return undefined;
        const { version } = await response.json() as { version?: unknown };
        return typeof version === 'string' && versionPattern.test(version) ? version : undefined;
    } catch { return undefined; }
}
