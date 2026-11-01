import { clearDraftMemory } from '../../../packages/toolbar/src/hooks/draftStorage';
import { configureToolbarRuntime, mountExtensionToolbar } from '@uier/toolbar/extension';
import { message, type Result } from './environment';
import type { ToolbarConfig } from '../../../packages/toolbar/src/config';

// Repeated executeScript does not register another listener or create another review layer.
const key = Symbol.for('uier.extension.content.v1');
const global = globalThis as unknown as Record<symbol, boolean>;
if (!global[key]) {
    global[key] = true;
    let unmount: (() => void) | undefined;
    let configured = false;
    let mounted = false;
    let config: ToolbarConfig;
    let pending: Promise<void> | undefined;
    const records = new Map<string, string>();
    const draftStorage = {
        get length() { return records.size; },
        key: (index: number) => [...records.keys()][index] ?? null,
        getItem: (key: string) => records.get(key) ?? null,
        setItem(key: string, value: string) { records.set(key, value); void message({ type: 'draft', key, value }).catch(() => {}); },
        removeItem(key: string) { records.delete(key); void message({ type: 'draft', key, value: null }).catch(() => {}); }
    };
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
        if (sender.id !== chrome.runtime.id) return;
        if (msg.type === 'stop') { mounted = false; unmount?.(); records.clear(); clearDraftMemory(); respond({ ok: true }); return; }
        if (msg.type !== 'mount') return;
        pending ??= (async () => {
            if (mounted) return;
            if (configured && config.project !== msg.config.project) throw new Error('Reload this page before choosing another project.');
            config = msg.config;
            const saved = await message<Record<string, string>>({ type: 'drafts' });
            records.clear(); for (const [key, value] of Object.entries(saved)) records.set(key, value);
            if (!configured) {
                configureToolbarRuntime({
                    config, draftStorage,
                    async request(url, init) {
                        const result = await message<Result>({ type: 'request', url, method: init?.method, body: init?.body });
                        return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
                    },
                    image: url => message<string>({ type: 'image', url }),
                    async capture(region) {
                        const { getToolbarHost } = await import('../../../packages/toolbar/src/mount');
                        const host = getToolbarHost();
                        const display = host?.style.getPropertyValue('display');
                        const priority = host?.style.getPropertyPriority('display');
                        try {
                            if (host) host.style.setProperty('display', 'none', 'important');
                            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                            return await message({ type: 'capture', region: { ...region, viewportWidth: innerWidth, viewportHeight: innerHeight } });
                        } finally { if (host) { if (display) host.style.setProperty('display', display, priority); else host.style.removeProperty('display'); } }
                    },
                    async signOut() { await message({ type: 'sign-out' }); records.clear(); clearDraftMemory(); unmount?.(); mounted = false; }
                });
                configured = true;
            }
            unmount = await mountExtensionToolbar(() => { mounted = false; void message({ type: 'exit' }); });
            mounted = true;
        })().finally(() => { pending = undefined; });
        void pending.then(() => respond({ ok: true }), error => respond({ ok: false, error: String(error) }));
        return true;
    });
}
