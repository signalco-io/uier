import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { commentSequenceId, type DbComment } from '../src/lib/db/schema';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';

// The in-memory comments store (the e2e server's), used directly. A partition's comment numbers
// are a document in it, as in Cosmos DB, and are never read, changed or listed as a comment. The
// Cosmos store (cosmosCommentsStore.ts) filters the same way; that one is checked by review only.

function comment(domain: string, id: string, number: number): DbComment {
    return {
        id,
        domain,
        path: '/',
        position: { type: 'point', selector: 'main', xNormal: 0.5, yNormal: 0.5 },
        number,
        thread: { items: [{ id: `item_${id}`, text: 'Hi', createdAt: new Date().toISOString() }] },
        resolved: false,
        createdAt: new Date().toISOString()
    };
}

test('the comment numbers\' sequence is never a comment', async () => {
    const store = getMemoryCommentsStore();
    const domain = `store-${randomUUID()}.localhost`;

    expect(await store.nextCommentNumber(domain)).toBe(1);
    await store.create(comment(domain, 'comment_first', 1));
    expect(await store.nextCommentNumber(domain)).toBe(2);

    expect(await store.get(domain, commentSequenceId)).toBeNull();
    expect((await store.list(domain, '/', 10)).map(c => c.id)).toEqual(['comment_first']);
    expect((await store.listAll(domain, 10)).map(c => c.id)).toEqual(['comment_first']);
    expect(await store.replace(comment(domain, commentSequenceId, 9), '1')).toBe('not_found');
    expect(await store.delete(domain, commentSequenceId, '1')).toBe('not_found');
    expect(await store.appendThreadItem(domain, commentSequenceId, { id: 'item_x', text: 'Hi' }, 50, new Date().toISOString())).toBe('not_found');

    // Still counting where it was
    expect(await store.nextCommentNumber(domain)).toBe(3);
});
