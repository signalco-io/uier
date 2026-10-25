import type { CommentAnchor, Mention } from '../components/@types/Comments';

export const draftStoragePrefix = 'uier:draft:v1:';
const maxDraftRecordLength = 64_000;
export const draftLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export type DraftDetails = {
    mentions?: Mention[];
    anchor?: { kind: 'comment' | 'rewrite'; position: CommentAnchor };
    originalText?: string;
};
type RecordValue = DraftDetails & { text: string; updatedAt: number; attempt?: { content: string; key: string } };

const memory = new Map<string, Map<string, RecordValue>>();
const listeners = new Map<string, Set<() => void>>();
const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
const pendingSends = new Map<string, Promise<unknown>>();

/** Small text/anchor records only. Captures and device details never enter synchronous storage. */
export function createDraftStore(scope: string[], onWrite?: () => void, persistent = true) {
    const prefix = `${draftStoragePrefix}${JSON.stringify(scope)}:`;
    const values = memory.get(prefix) ?? new Map<string, RecordValue>();
    memory.set(prefix, values);
    let available = persistent;
    const storageKeys = () => persistent
        ? Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        : [];
    const remove = (key: string) => {
        try { if (persistent) localStorage.removeItem(prefix + key); } catch { available = false; }
        values.delete(key);
        notify(prefix + key);
    };
    const read = (key: string): RecordValue | undefined => {
        let value = values.get(key);
        if (!value) {
            try {
                const raw = persistent ? localStorage.getItem(prefix + key) : null;
                if (raw && raw.length <= maxDraftRecordLength) value = JSON.parse(raw) as RecordValue;
            } catch { available = false; }
        }
        if (!value) return undefined;
        if (typeof value.text !== 'string' || value.text.length > 1000 || !Number.isFinite(value.updatedAt)
            || value.updatedAt + draftLifetimeMs <= Date.now() || value.updatedAt > Date.now() + 60_000) {
            remove(key); return undefined;
        }
        if (value.anchor) {
            const a = value.anchor;
            const p = a.position;
            const selector = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 1024;
            const offset = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100_000;
            if (!p || !['comment', 'rewrite'].includes(a.kind)
                || !(p.type === 'point' ? selector(p.selector) && Number.isFinite(p.xNormal) && p.xNormal >= 0 && p.xNormal <= 1 && Number.isFinite(p.yNormal) && p.yNormal >= 0 && p.yNormal <= 1
                    : p.type === 'text' && selector(p.startSelector) && (p.endSelector === undefined || selector(p.endSelector)) && typeof p.text === 'string' && p.text.length <= 2000
                        && offset(p.startOffset) && offset(p.endOffset) && ['text', 'element'].includes(p.startType) && ['text', 'element'].includes(p.endType))) delete value.anchor;
        }
        if (value.mentions !== undefined) {
            let end = 0;
            if (!Array.isArray(value.mentions) || value.mentions.length > 20 || value.mentions.some(mention => {
                if (!mention || typeof mention.userId !== 'string' || !/^u_[A-Za-z0-9_-]{1,64}$/.test(mention.userId)
                    || !Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < end
                    || mention.end <= mention.start + 1 || mention.end > value!.text.length || value!.text[mention.start] !== '@') return true;
                end = mention.end;
                return false;
            })) delete value.mentions;
        }
        values.set(key, value);
        return value;
    };
    const write = (key: string, value: RecordValue) => {
        values.set(key, value);
        if (persistent) onWrite?.();
        try { if (persistent) { localStorage.setItem(prefix + key, JSON.stringify(value)); available = true; } }
        catch { available = false; }
        notify(prefix + key);
    };
    // Prune expired records across scopes without retaining any draft contents in memory.
    try {
        for (const key of storageKeys()) {
            if (!key?.startsWith(draftStoragePrefix)) continue;
            try {
                const raw = localStorage.getItem(key);
                const value = raw && raw.length <= maxDraftRecordLength ? JSON.parse(raw) as RecordValue : undefined;
                if (!value || !Number.isFinite(value.updatedAt) || value.updatedAt + draftLifetimeMs <= Date.now()) localStorage.removeItem(key);
            } catch { localStorage.removeItem(key); }
        }
    } catch { available = false; }
    return {
        subscribe(key: string, listener: () => void) {
            const fullKey = prefix + key;
            const subscriptions = listeners.get(fullKey) ?? new Set<() => void>();
            listeners.set(fullKey, subscriptions);
            subscriptions.add(listener);
            return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(fullKey); };
        },
        get: (key: string) => read(key)?.text,
        details: (key: string) => read(key),
        set(key: string, text: string) {
            write(key, { ...read(key), text, updatedAt: Date.now() });
        },
        setDetails(key: string, details: DraftDetails) {
            write(key, { ...read(key), text: read(key)?.text ?? '', ...details, updatedAt: Date.now() });
        },
        delete: remove,
        clear() {
            // All pages for this authorized reviewer/project, not other reviewers or projects.
            const reviewerPrefix = `${draftStoragePrefix}${JSON.stringify(scope.slice(0, -1)).slice(0, -1)},`;
            for (const [key, records] of memory) if (key.startsWith(reviewerPrefix)) records.clear();
            try {
                for (const key of storageKeys()) {
                    if (key?.startsWith(reviewerPrefix)) localStorage.removeItem(key);
                }
            } catch { available = false; }
            for (const key of listeners.keys()) if (key.startsWith(reviewerPrefix)) notify(key);
        },
        available: () => available,
        pending: (key: string) => pendingSends.has(prefix + key),
        attempt(key: string, content: string) {
            const previous = read(key);
            if (previous?.attempt?.content === content && /^[A-Za-z0-9_-]{16,128}$/.test(previous.attempt.key)) return previous.attempt.key;
            const identity = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
            write(key, { ...previous, text: previous?.text ?? '', updatedAt: Date.now(), attempt: { content, key: identity } });
            return identity;
        },
        async run<T>(key: string, send: () => Promise<T>): Promise<T> {
            const lockKey = prefix + key;
            const pending = pendingSends.get(lockKey);
            if (pending) return pending as Promise<T>;
            const promise = send();
            pendingSends.set(lockKey, promise);
            notify(lockKey);
            try { return await promise; } finally { pendingSends.delete(lockKey); notify(lockKey); }
        }
    };
}
