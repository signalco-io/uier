/// <reference path="../../../packages/toolbar/src/globals.d.ts" />
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDraftStore, draftLifetimeMs, draftStoragePrefix } from '../../../packages/toolbar/src/hooks/draftStorage';

test('draft scopes, expiry, clear, corrupt data and blocked/quota-limited storage', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const data = new Map<string, string>();
    let blocked = false;
    const storage = {
        get length() { return data.size; },
        key: (index: number) => [...data.keys()][index] ?? null,
        getItem: (key: string) => { if (blocked) throw new Error('Blocked'); return data.get(key) ?? null; },
        setItem: (key: string, value: string) => { if (blocked) throw new Error('QuotaExceeded'); data.set(key, value); },
        removeItem: (key: string) => {
            if (blocked) throw new Error('Blocked');
            data.delete(key);
            // Storage key order is allowed to change on removal. Clear must snapshot keys first.
            const remaining = [...data].reverse();
            data.clear();
            remaining.forEach(([name, value]) => data.set(name, value));
        }
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const pageScope = ['https://api.test', randomUUID(), 'reviewer-a', '/page?tab=a'];
    try {
        const a = createDraftStore(pageScope);
        a.set('new', 'Keep this');
        a.setDetails('new', { anchor: { kind: 'comment', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } } });
        const attempt = a.attempt('new', 'same payload');
        expect(createDraftStore(pageScope).attempt('new', 'same payload')).toBe(attempt);
        expect(a.attempt('new', 'changed payload')).not.toBe(attempt);
        for (const scope of [[...pageScope.slice(0, 3), '/page?tab=b'], [pageScope[0]!, pageScope[1]!, 'reviewer-b', pageScope[3]!], [pageScope[0]!, 'other-project', ...pageScope.slice(2)]]) {
            expect(createDraftStore(scope).get('new')).toBeUndefined();
        }
        const otherPage = createDraftStore([...pageScope.slice(0, 3), '/other']);
        otherPage.set('reply', 'Other page');
        otherPage.set('edit:reply', 'Another edit');
        a.set('feedback:bug', 'Bug draft');
        a.clear();
        expect(a.get('new')).toBeUndefined();
        expect(otherPage.get('reply')).toBeUndefined();
        expect(otherPage.get('edit:reply')).toBeUndefined();
        expect(a.get('feedback:bug')).toBeUndefined();
        const expiredScope = [...pageScope.slice(0, 3), '/expired'];
        storage.setItem(`${draftStoragePrefix}${JSON.stringify(expiredScope)}:new`, JSON.stringify({ text: 'Expired', updatedAt: Date.now() - draftLifetimeMs - 1 }));
        expect(createDraftStore(expiredScope).get('new')).toBeUndefined();
        expect([...data.values()]).not.toContain('Expired');
        storage.setItem(`${draftStoragePrefix}${JSON.stringify(expiredScope)}:new`, 'malformed json');
        expect(createDraftStore(expiredScope).get('new')).toBeUndefined();
        blocked = true;
        a.set('new', 'Quota-safe text');
        expect(a.get('new')).toBe('Quota-safe text');
        expect(a.available()).toBe(false);
        expect(createDraftStore(pageScope).get('new')).toBe('Quota-safe text');
        let sends = 0;
        let finish!: () => void;
        const send = () => { sends++; return new Promise<void>(resolve => { finish = resolve; }); };
        const first = a.run('new', send);
        const second = a.run('new', send);
        expect(createDraftStore(pageScope).pending('new')).toBe(true);
        finish();
        await Promise.all([first, second]);
        expect(sends).toBe(1);
        expect(a.pending('new')).toBe(false);
        a.clear();
        expect(a.get('new')).toBeUndefined();
    } finally {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
        else Reflect.deleteProperty(globalThis, 'localStorage');
    }
});
