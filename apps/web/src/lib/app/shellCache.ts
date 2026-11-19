import type { CachedSidebar } from '@/src/components/app/shell/AppSidebar';
import type { AppLanguage } from '../i18n/languages';
import type { AppCatalog } from '../i18n/types';
import { cacheDelete, cacheDeletePrefix, cacheGet, cacheKeys, cacheSet } from './browserCache';
import { loadAllCachedImages } from './imageCache';

/**
 * What the signed-in shell last showed for one account in one workspace, kept in this browser (`browserCache`) so a
 * full load, a workspace switch and an account switch can draw the sidebar at once: the workspace's name, logo and
 * the person's role, the other workspaces, the projects with their favicons, clients and open counts, the signed-in
 * accounts and the app's language. The server's render replaces it as soon as it arrives and saves the new one, so
 * it is never more than one load behind. Never a source of truth: drawn inert, and pages and actions read and
 * authorize for themselves ([app shell](../../../docs/app-shell.md#local-shell-cache)).
 */
export type ShellSnapshot = {
    version: typeof SNAPSHOT_VERSION;
    savedAt: number;
    userId: string;
    workspaceId: string;
    language: AppLanguage;
    sidebar: CachedSidebar;
};

export type CachedShellView = {
    snapshot: ShellSnapshot;
    catalog: AppCatalog;
    /** The docked sidebar is collapsed to icons (a switch keeps the live sidebar's state) */
    collapsed?: boolean;
};

type ShellKey = { userId: string; workspaceId: string };

/** A change to the snapshot's shape bumps this, so an older copy is never drawn */
const SNAPSHOT_VERSION = 1;
/** A copy not refreshed in this long is too old to draw: removed when it is next read */
export const SHELL_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const SHELL_PREFIX = 'shell:';
const CURRENT_KEY = 'shell-current';
const CATALOG_PREFIX = 'catalog:';

const userPrefix = (userId: string) => `${SHELL_PREFIX}${encodeURIComponent(userId)}:`;
const shellKey = ({ userId, workspaceId }: ShellKey) => `${userPrefix(userId)}${encodeURIComponent(workspaceId)}`;

function isFresh(snapshot: ShellSnapshot | undefined): snapshot is ShellSnapshot {
    return snapshot?.version === SNAPSHOT_VERSION && Date.now() - snapshot.savedAt < SHELL_CACHE_MAX_AGE;
}

/** The live shell of this document, once it has rendered */
let live: ShellKey | undefined;
let lastSaved: string | undefined;
let pruned = false;
const savedCatalogs = new Set<AppLanguage>();

export function liveShell() {
    return live;
}

/**
 * Saves what the live shell rendered (only when it changed) and makes it the copy the next full load draws. Once per
 * document, removes the copies of accounts no longer signed in to this browser.
 */
export async function saveShellSnapshot(snapshot: Omit<ShellSnapshot, 'version' | 'savedAt'>) {
    const key = { userId: snapshot.userId, workspaceId: snapshot.workspaceId };
    live = key;
    reportLiveShell(key);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSaved)
        return;
    lastSaved = serialized;
    await cacheSet(shellKey(key), { ...snapshot, version: SNAPSHOT_VERSION, savedAt: Date.now() } satisfies ShellSnapshot);
    await cacheSet(CURRENT_KEY, key);
    if (!pruned) {
        pruned = true;
        const signedIn = new Set(snapshot.sidebar.accounts.map(account => userPrefix(account.id)));
        signedIn.add(userPrefix(snapshot.userId));
        const stale = (await cacheKeys(SHELL_PREFIX)).filter(stored => ![...signedIn].some(prefix => stored.startsWith(prefix)));
        await cacheDelete(stale);
    }
}

/** The language's catalog, once per document (English needs none: its phrases are the source) */
export async function saveAppCatalog(language: AppLanguage, catalog: AppCatalog) {
    if (language === 'en' || savedCatalogs.has(language))
        return;
    savedCatalogs.add(language);
    await cacheSet(`${CATALOG_PREFIX}${language}`, catalog);
}

async function readView(key: ShellKey): Promise<CachedShellView | undefined> {
    const snapshot = await cacheGet<ShellSnapshot>(shellKey(key));
    if (!isFresh(snapshot)) {
        if (snapshot)
            await cacheDelete(shellKey(key));
        return undefined;
    }
    const [catalog] = await Promise.all([
        snapshot.language === 'en' ? {} : cacheGet<AppCatalog>(`${CATALOG_PREFIX}${snapshot.language}`),
        // The favicons and the logo are in its first paint
        loadAllCachedImages()
    ]);
    // Without its language's words the sidebar would speak English and then change: draw the frame instead
    return catalog ? { snapshot, catalog } : undefined;
}

/** The copy a full load draws: the account and workspace the last shell (or a switch) left as current */
export async function readCurrentShell() {
    const current = await cacheGet<ShellKey>(CURRENT_KEY);
    return current ? readView(current) : undefined;
}

/**
 * Where an account switch is likely to open, as `getAppContext` picks it: the workspace selected now when the
 * account is in it, else its own, else another of its own workspaces. The memberships are those of its last copy.
 */
async function predictAccountShell(userId: string): Promise<ShellKey | undefined> {
    const snapshots = (await Promise.all((await cacheKeys(userPrefix(userId))).map(key => cacheGet<ShellSnapshot>(key))))
        .filter(isFresh)
        .sort((a, b) => b.savedAt - a.savedAt);
    const workspaces = snapshots[0]?.sidebar.workspaces;
    if (!workspaces)
        return undefined;
    const workspace = (live && workspaces.find(option => option.id === live!.workspaceId))
        ?? workspaces.find(option => option.home)
        ?? workspaces.find(option => !option.feedback);
    return workspace && { userId, workspaceId: workspace.id };
}

/** The next full load draws this account's likely workspace, or the plain frame when there is none */
export async function selectAccountShell(userId: string) {
    const key = await predictAccountShell(userId);
    await (key ? cacheSet(CURRENT_KEY, key) : cacheDelete(CURRENT_KEY));
    return key;
}

/** The next full load draws this document's shell again (a switch that failed) */
export async function restoreCurrentShell() {
    await (live ? cacheSet(CURRENT_KEY, live) : cacheDelete(CURRENT_KEY));
}

/** The next full load draws the plain frame (a sign-in, or a destination the browser can't predict) */
export async function forgetCurrentShell() {
    await cacheDelete(CURRENT_KEY);
}

/** Signing out of one account removes its copies; signing out of the last (or of all) removes every copy */
export async function forgetShells(userId?: string) {
    await cacheDelete(CURRENT_KEY);
    await cacheDeletePrefix(userId ? userPrefix(userId) : SHELL_PREFIX);
    if (!userId)
        await cacheDeletePrefix('image:');
}

// A switch in progress: the cached shell of its destination draws over the live one until the destination renders

type ShellSwitch = { from?: ShellKey; view: CachedShellView };

let current: ShellSwitch | undefined;
let generation = 0;
let timeout: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setSwitch(next: ShellSwitch | undefined) {
    current = next;
    clearTimeout(timeout);
    // Never stuck: a switch that neither renders nor fails within this long shows the live shell again
    if (next)
        timeout = setTimeout(() => endShellSwitch(), 20_000);
    for (const listener of listeners) listener();
}

export function subscribeShellSwitch(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getShellSwitch() {
    return current;
}

/** Draws the destination's copy at once, when this browser has one; the live shell takes over once it renders */
export async function beginShellSwitch(to: ShellKey) {
    const started = ++generation;
    const view = await readView(to);
    if (!view || started !== generation)
        return;
    const collapsed = document.querySelector('[data-app-shell] [data-slot="sidebar"][data-state="collapsed"]') !== null;
    setSwitch({ from: live, view: { ...view, collapsed } });
}

export function endShellSwitch() {
    generation++;
    if (current)
        setSwitch(undefined);
}

/** The live shell rendered: a switch ends once it shows another account or workspace than the one it left */
function reportLiveShell(key: ShellKey) {
    if (current && (current.from?.userId !== key.userId || current.from.workspaceId !== key.workspaceId))
        endShellSwitch();
}
