import { browser, browserKind, clientId, extensionOrigin } from './browser';
import { parseWorkerMessage, type CaptureRegion } from './protocol';
import { apiOrigin, type Binding, type Session, type Credentials, type RefreshSession, type Result, sessionKey, refreshKey, random, reviewable } from './environment';
import { credentialStorage, secureStorage } from './storage';
import { redirectURL, launchAuth } from './auth';
import { readyUpdate, updateState, watchUpdates } from './update';
import { extensionOperation } from '@uier/toolbar/extension-contract';

// Never expose worker-owned credentials or private drafts to content-script storage APIs.
const ready = secureStorage();
watchUpdates();
let authEpoch = 0;
let signingOut = false;
let activationRevision = 0;
browser.tabs.onActivated.addListener(() => { activationRevision++; });
const bindingKey = (tabId: number) => `binding:${tabId}`;
// Serialize credential writes with sign-out. Network calls never hold this queue.
let authWrites = Promise.resolve();
function writeAuth(operation: () => Promise<void>) {
    const write = authWrites.then(operation);
    authWrites = write.catch(() => {});
    return write;
}
function assertAuthEpoch(epoch: number) {
    if (signingOut || epoch !== authEpoch) throw new Error('This sign-in has ended.');
}
async function saveCredentials(credentials: Credentials, id: string, epoch: number) {
    await writeAuth(async () => {
        assertAuthEpoch(epoch);
        if (credentials.refreshToken && credentials.refreshExpiresAt) {
            await credentialStorage.set({ [refreshKey]: { id, refreshToken: credentials.refreshToken, refreshExpiresAt: credentials.refreshExpiresAt } satisfies RefreshSession });
        }
        await browser.storage.session.set({ [sessionKey]: { id, token: credentials.token, expiresAt: credentials.expiresAt } satisfies Session });
    });
}
let refreshing: Promise<Session> | undefined;
async function currentSession(): Promise<Session> {
    if (signingOut) throw new Error('Sign-out is in progress.');
    const epoch = authEpoch;
    const value = (await browser.storage.session.get(sessionKey))[sessionKey] as Session | undefined;
    assertAuthEpoch(epoch);
    if (value && value.expiresAt > Date.now() + 60_000) return value;
    const retained = (await credentialStorage.get(refreshKey))[refreshKey] as RefreshSession | undefined;
    assertAuthEpoch(epoch);
    if (!retained || retained.refreshExpiresAt <= Date.now()) {
        if (value && value.expiresAt > Date.now()) return value;
        throw new Error('Sign in to uier again.');
    }
    const attempt = retained.attempt ?? random();
    // Persist before sending, so worker suspension or a lost response retries the same rotation.
    await writeAuth(async () => {
        assertAuthEpoch(epoch);
        await credentialStorage.set({ [refreshKey]: { ...retained, attempt } });
    });
    const response = await api('refresh', undefined, 'POST', { clientId, refreshToken: retained.refreshToken, attempt, ...(browserKind === 'chrome' ? {} : { extensionOrigin: extensionOrigin() }) });
    assertAuthEpoch(epoch);
    if (response.status === 401) {
        await signOut().catch(() => {});
        throw new Error('Sign in to uier again.');
    }
    const credentials = await json<Credentials>(response);
    await saveCredentials(credentials, retained.id, epoch);
    return { id: retained.id, token: credentials.token, expiresAt: credentials.expiresAt };
}
function session() {
    if (!refreshing) {
        const pending = currentSession();
        refreshing = pending;
        void pending.finally(() => { if (refreshing === pending) refreshing = undefined; }).catch(() => {});
    }
    return refreshing;
}
async function api(path: string, token?: string, method = 'GET', body?: unknown, proof?: string): Promise<Response> {
    return fetch(`${apiOrigin}/api/extension/${path}`, {
        method, credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(proof ? { 'X-Uier-Verification': proof } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
}
async function json<T>(response: Response): Promise<T> {
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'The extension could not connect.');
    return result as T;
}
async function getBinding(tabId: number) {
    return (await browser.storage.session.get(bindingKey(tabId)))[bindingKey(tabId)] as Binding | undefined;
}
async function clearBinding(tabId: number) { await browser.storage.session.remove(bindingKey(tabId)); }
async function actualDocument(binding: Binding, sender?: chrome.runtime.MessageSender, allowNewDocument = false) {
    const credentials = await session();
    const currentBinding = await getBinding(binding.tabId);
    if (credentials.id !== binding.sessionId || currentBinding?.activation !== binding.activation) throw new Error('This review has ended.');
    const tab = await browser.tabs.get(binding.tabId);
    if (!reviewable(tab.url) || new URL(tab.url!).origin !== binding.origin || (tab.pendingUrl && (!reviewable(tab.pendingUrl) || new URL(tab.pendingUrl).origin !== binding.origin))) {
        await clearBinding(binding.tabId); throw new Error('This site changed. Choose Start review again.');
    }
    if (binding.documentId && !allowNewDocument) {
        const current = await browser.scripting.executeScript({ target: { tabId: binding.tabId, frameIds: [0] }, world: 'ISOLATED', func: () => location.href });
        if (current[0]?.documentId !== binding.documentId) throw new Error('This review document is no longer active.');
    }
    if (sender && (sender.id !== browser.runtime.id || sender.tab?.id !== binding.tabId || sender.frameId !== 0
        || !sender.documentId || !reviewable(sender.url) || new URL(sender.url!).origin !== binding.origin
        || sender.documentId !== binding.documentId)) throw new Error('This review document is no longer active.');
    return tab;
}
async function scope(binding: Binding) {
    const epoch = authEpoch;
    if (!binding.scope || binding.scope.expiresAt < Date.now() + 30_000) {
        binding.scope = await json(await api('scope', (await session()).token, 'POST', { projectId: binding.projectId, origin: binding.origin }));
        await actualDocument(binding);
        if (epoch !== authEpoch) throw new Error('This review has ended.');
        await browser.storage.session.set({ [bindingKey(binding.tabId)]: binding });
    }
    return binding.scope!;
}
async function signIn() {
    const epoch = authEpoch;
    const verifier = random(), state = random();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const redirectUri = redirectURL();
    const query = new URLSearchParams({ clientId, redirectUri, state, challenge, renewable: 'true', ...(browserKind === 'chrome' ? {} : { extensionOrigin: extensionOrigin() }) });
    const result = await launchAuth(`${apiOrigin}/app/extension?${query}`);
    if (!result) throw new Error('Sign-in was cancelled.');
    const url = new URL(result);
    if (url.origin + url.pathname !== redirectUri || url.hash || url.searchParams.get('state') !== state) throw new Error('Invalid sign-in callback.');
    const credentials = await json<Credentials>(await api('token', undefined, 'POST', { clientId, redirectUri, code: url.searchParams.get('code'), verifier, renewable: true }));
    assertAuthEpoch(epoch);
    // Switching accounts retires all old proofs, private data and active tabs first.
    await signOut().catch(() => {});
    await saveCredentials(credentials, random(), epoch + 1);
}
let signOutTask: Promise<void> | undefined;
function signOut() {
    if (!signOutTask) {
        const pending = clearSession();
        signOutTask = pending;
        void pending.finally(() => { if (signOutTask === pending) signOutTask = undefined; }).catch(() => {});
    }
    return signOutTask;
}
async function clearSession() {
    authEpoch++; signingOut = true;
    refreshing = undefined;
    try {
        await authWrites;
        const retained = (await credentialStorage.get(refreshKey))[refreshKey] as RefreshSession | undefined;
        const previous = (await browser.storage.session.get(sessionKey))[sessionKey] as Session | undefined;
        if (retained || previous) {
            const response = await api('session', retained?.refreshToken ?? previous!.token, 'DELETE');
            if (!response.ok && response.status !== 401) throw new Error('Browser data was cleared, but server sign-out was not confirmed.');
        }
    } finally {
        const bound = await boundTabs();
        await writeAuth(async () => {
            await credentialStorage.remove(refreshKey);
            await browser.storage.session.clear();
        });
        await disposeTabs(bound);
        signingOut = false;
    }
}

async function boundTabs() {
    const values = await browser.storage.session.get(null);
    return Object.keys(values).filter(key => key.startsWith('binding:')).map(key => Number(key.slice(8)));
}
async function disposeTabs(tabIds: number[]) {
    await Promise.all(tabIds.map(tabId => browser.tabs.sendMessage(tabId, { type: 'dispose' }).catch(() => {})));
}
/** A restart ends every review, as an automatic update does; remove the toolbars before it orphans them. */
async function installUpdate() {
    if (!await readyUpdate()) throw new Error('No update is ready to install.');
    await disposeTabs(await boundTabs());
    // Answer the popup first; the restart closes it.
    setTimeout(() => browser.runtime.reload(), 100);
}

const verifying = new Map<string, Promise<string>>();
let draftWrites: Promise<unknown> = Promise.resolve();
async function verification(binding: Binding) {
    const epoch = authEpoch;
    // Proofs only live in trusted session storage and are bound to this project/site/reviewer.
    const key = `proof:${binding.tabId}`;
    const cached = (await browser.storage.session.get(key))[key] as { token: string; expiresAt: number; projectId: string; origin: string } | undefined;
    if (cached && cached.projectId === binding.projectId && cached.origin === binding.origin && cached.expiresAt > Date.now() + 30_000) return cached.token;
    if (verifying.has(binding.activation)) return verifying.get(binding.activation)!;
    const pending = (async () => {
        const nonce = random();
        const credentials = await scope(binding);
        const jobKey = `verification:${nonce}`;
        await browser.storage.session.set({ [jobKey]: { token: credentials.token, tabId: binding.tabId } });
        const helper = await browser.windows.create({ url: browser.runtime.getURL(`helper.html#${nonce}`), type: 'popup', width: 420, height: 220, focused: false });
        try {
            // The helper reports through trusted extension messaging; no reviewed-page listener.
            const proof = await new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
                const timeout = setTimeout(() => finish(undefined), 25_000);
                const receive = (msg: any, sender: chrome.runtime.MessageSender) => {
                    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL(`helper.html#${nonce}`) || msg?.type !== 'verified' || msg.nonce !== nonce) return;
                    finish(msg.proof);
                };
                const finish = (proof: any) => {
                    clearTimeout(timeout); browser.runtime.onMessage.removeListener(receive);
                    if (typeof proof?.token === 'string' && proof.token.length < 2048 && typeof proof.expiresAt === 'number') resolve(proof);
                    else reject(new Error('Browser verification failed. Try Start review again.'));
                };
                browser.runtime.onMessage.addListener(receive);
            });
            await actualDocument(binding);
            if (epoch !== authEpoch) throw new Error('This review has ended.');
            await browser.storage.session.set({ [key]: { ...proof, projectId: binding.projectId, origin: binding.origin } });
            return proof.token;
        } finally {
            await browser.storage.session.remove(jobKey);
            if (helper?.id) await browser.windows.remove(helper.id).catch(() => {});
        }
    })();
    verifying.set(binding.activation, pending);
    try { return await pending; } finally { verifying.delete(binding.activation); }
}
async function inject(binding: Binding) {
    const epoch = authEpoch;
    await actualDocument(binding, undefined, true);
    // executeScript returns the actual browser document ID; never take it from a page payload.
    const result = await browser.scripting.executeScript({ target: { tabId: binding.tabId, frameIds: [0] }, world: 'ISOLATED', files: ['content.js'] });
    if (!result[0]?.documentId) throw new Error('This browser page cannot be reviewed.');
    binding.documentId = result[0].documentId;
    await actualDocument(binding);
    if (epoch !== authEpoch) throw new Error('This review has ended.');
    await browser.storage.session.set({ [bindingKey(binding.tabId)]: binding });
    const mounted = await browser.tabs.sendMessage(binding.tabId, { type: 'mount', config: { apiUrl: apiOrigin, project: binding.publicId, mode: 'review' } }, { documentId: binding.documentId });
    if (!mounted?.ok) throw new Error(mounted?.error || 'The review could not start.');
}
async function start(tabId: number, projectId: string, publicId: string) {
    const tab = await browser.tabs.get(tabId);
    if (!tab.active || !reviewable(tab.url)) throw new Error('Open a website to start a review. Browser pages and extension stores cannot be reviewed.');
    const previous = await getBinding(tabId);
    if (previous) {
        if (previous.projectId === projectId && previous.publicId === publicId && previous.origin === new URL(tab.url!).origin) {
            await actualDocument(previous); await scope(previous); await verification(previous); await inject(previous); return;
        }
        await browser.tabs.sendMessage(tabId, { type: 'dispose' }, previous.documentId ? { documentId: previous.documentId } : {}).catch(() => {});
        await clearBinding(tabId);
    }
    const binding: Binding = { activation: random(), sessionId: (await session()).id, tabId, origin: new URL(tab.url!).origin, projectId, publicId };
    await browser.storage.session.set({ [bindingKey(tabId)]: binding });
    try {
    await scope(binding); // Server validates current membership and exact origin before injection.
    await verification(binding);
    await inject(binding);
    } catch (error) { if ((await getBinding(tabId))?.activation === binding.activation) await clearBinding(tabId); throw error; }
}
async function contentBinding(sender: chrome.runtime.MessageSender) {
    const binding = sender.tab?.id !== undefined ? await getBinding(sender.tab.id) : undefined;
    if (!binding) throw new Error('This review has ended.');
    await actualDocument(binding, sender);
    return binding;
}
async function serialize(response: Response): Promise<Result> {
    return { status: response.status, headers: [...response.headers], body: await response.text() };
}
async function handle(input: unknown, sender: chrome.runtime.MessageSender) {
    const msg = parseWorkerMessage(input);
    await ready;
    if (sender.id !== browser.runtime.id) throw new Error('Unknown extension sender.');
    const popup = sender.url === browser.runtime.getURL('popup.html');
    if (popup) {
        if (msg.type === 'sign-in') return signIn();
        if (msg.type === 'sign-out') return signOut();
        if (msg.type === 'update') return updateState();
        if (msg.type === 'install-update') return installUpdate();
        if (msg.type === 'state') {
            let signedIn = false;
            try { await session(); signedIn = true; } catch (error) {
                // A temporary refresh failure must offer retry rather than another interactive login.
                const retained = (await credentialStorage.get(refreshKey))[refreshKey] as RefreshSession | undefined;
                if (retained && retained.refreshExpiresAt > Date.now()) throw error;
            }
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (!signedIn || !tab?.id || !reviewable(tab.url)) return { signedIn, restricted: !reviewable(tab?.url) };
            const origin = new URL(tab.url!).origin;
            const result = await json<any>(await api(`projects?${new URLSearchParams({ origin })}`, (await session()).token));
            const binding = await getBinding(tab.id);
            return { ...result, signedIn, tabId: tab.id, origin, binding: Boolean(binding), reviewing: binding?.projectId };
        }
        if (msg.type === 'start' && Number.isInteger(msg.tabId) && typeof msg.projectId === 'string' && typeof msg.publicId === 'string') return start(msg.tabId, msg.projectId, msg.publicId);
        if (msg.type === 'exit' && msg.tabId !== undefined) { await clearBinding(msg.tabId); await browser.tabs.sendMessage(msg.tabId, { type: 'dispose' }).catch(() => {}); return; }
        throw new Error('Unsupported popup operation.');
    }
    if (sender.url?.startsWith(browser.runtime.getURL('helper.html#')) && !sender.tab?.url?.startsWith('http')) {
        if (msg.type === 'helper-job' && /^[A-Za-z0-9_-]{43}$/.test(msg.nonce) && sender.url === browser.runtime.getURL(`helper.html#${msg.nonce}`))
            return (await browser.storage.session.get(`verification:${msg.nonce}`))[`verification:${msg.nonce}`];
        if (msg.type === 'verified') return;
    }
    let binding: Binding;
    try { binding = await contentBinding(sender); } catch (error) {
        if (msg.type === 'request') return { status: 401, headers: [['Content-Type', 'application/json']], body: JSON.stringify({ error: 'sign_in_required', message: 'This extension review has ended. Open the extension and sign in again.' }) };
        throw error;
    }
    if (msg.type === 'exit') { await clearBinding(binding.tabId); return; }
    if (msg.type === 'sign-out') return signOut();
    if (msg.type === 'drafts') {
        const key = `drafts:${binding.projectId}:${binding.origin}`;
        const records = ((await browser.storage.session.get(key))[key] ?? {}) as Record<string, string>;
        return records;
    }
    if (msg.type === 'draft' && typeof msg.key === 'string' && msg.key.length < 2048 && msg.key.startsWith('uier:draft:v1:')) {
        const write = draftWrites.then(async () => {
            await actualDocument(binding, sender);
            const key = `drafts:${binding.projectId}:${binding.origin}`;
            const records = ((await browser.storage.session.get(key))[key] ?? {}) as Record<string, string>;
            if (msg.value === null) delete records[msg.key];
            else if (typeof msg.value === 'string' && msg.value.length <= 64_000 && !msg.value.includes('data:image/')) records[msg.key] = msg.value;
            else throw new Error('Invalid draft.');
            // Bound session growth; the shared store prunes expiry on every mount.
            if (JSON.stringify(records).length > 1_000_000) throw new Error('Draft storage is full.');
            await browser.storage.session.set({ [key]: records });
        });
        draftWrites = write.catch(() => {});
        return write;
    }
    if (msg.type === 'capture') return capture(binding, msg.region);
    if (msg.type === 'request' || msg.type === 'image') {
        const method = msg.type === 'image' ? 'GET' : msg.method ?? 'GET';
        const { path, query } = extensionOperation(msg.url, apiOrigin, binding.publicId, method);
        const token = (await scope(binding)).token;
        const proof = method !== 'GET' ? await verification(binding) : undefined;
        await actualDocument(binding, sender);
        const response = await api(`review/${path || 'info'}${query}`, token, method, msg.type === 'image' ? undefined : msg.body, proof);
        await actualDocument(binding, sender);
        if (msg.type === 'image') {
            if (!response.ok) throw new Error('The screenshot could not be loaded.');
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length > 512 * 1024) throw new Error('Screenshot is too large.');
            let data = ''; for (const byte of bytes) data += String.fromCharCode(byte);
            return `data:${response.headers.get('content-type')};base64,${btoa(data)}`;
        }
        return serialize(response);
    }
    throw new Error('Unsupported review operation.');
}
browser.runtime.onMessage.addListener((msg, sender, respond) => {
    void handle(msg, sender).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error instanceof Error ? error.message : 'The extension could not connect.' }));
    return true;
});
browser.tabs.onRemoved.addListener(tabId => { void clearBinding(tabId); });
browser.tabs.onUpdated.addListener((tabId, change) => {
    void (async () => {
        const binding = await getBinding(tabId);
        if (!binding) return;
        if (change.url && (!reviewable(change.url) || new URL(change.url).origin !== binding.origin)) { await clearBinding(tabId); return; }
        if (change.status === 'complete') await inject(binding).catch(() => clearBinding(tabId));
    })();
});

async function capture(binding: Binding, region: CaptureRegion) {
    if (!region || Object.values(region).some(n => typeof n !== 'number' || !Number.isFinite(n)) || region.left < 0 || region.top < 0 || region.width <= 0 || region.height <= 0 || region.viewportWidth <= 0 || region.viewportHeight <= 0 || region.left + region.width > region.viewportWidth + 1 || region.top + region.height > region.viewportHeight + 1) throw new Error('Invalid screenshot region.');
    const revision = activationRevision;
    const tab = await actualDocument(binding);
    const active = await browser.tabs.query({ active: true, windowId: tab.windowId });
    if (active[0]?.id !== binding.tabId) throw new Error('Return to the reviewed tab to capture it.');
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const after = await browser.tabs.query({ active: true, windowId: tab.windowId });
    if (after[0]?.id !== binding.tabId || activationRevision !== revision) throw new Error('The active tab changed during capture.');
    await actualDocument(binding);
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]!), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
        const scaleX = image.width / region.viewportWidth, scaleY = image.height / region.viewportHeight;
        const fit = Math.min(1, 2400 / (region.width * scaleX), 2400 / (region.height * scaleY));
        let width = Math.max(1, Math.round(region.width * scaleX * fit)), height = Math.max(1, Math.round(region.height * scaleY * fit));
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = new OffscreenCanvas(width, height);
            canvas.getContext('2d')!.drawImage(image, region.left * scaleX, region.top * scaleY, region.width * scaleX, region.height * scaleY, 0, 0, width, height);
            for (const quality of [0.85, 0.7, 0.55]) {
                const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
                if (blob.size <= 480 * 1024) {
                    const data = new Uint8Array(await blob.arrayBuffer());
                    let raw = ''; for (const byte of data) raw += String.fromCharCode(byte);
                    return { dataUrl: `data:${blob.type};base64,${btoa(raw)}`, width, height };
                }
            }
            width = Math.max(1, Math.round(width * 0.75)); height = Math.max(1, Math.round(height * 0.75));
        }
        throw new Error('Screenshot is too large.');
    } finally { image.close(); }
}
