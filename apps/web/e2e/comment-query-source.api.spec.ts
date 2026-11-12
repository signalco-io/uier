import { randomUUID } from 'node:crypto';
import type { Container, SqlQuerySpec } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import type { DbComment, DbScreenshot, DbSubmission } from '../src/lib/db/schema';
import { screenshotDocumentId } from '../src/lib/db/schema';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { CommentQueryBudgetError, normalizeCandidate, toCommentQueryCandidate, type CommentQueryCandidate } from '../src/lib/repo/commentQuerySource';
import { commentQueryMetadata } from '../src/lib/repo/queryMetadata';
import { aiTitleSource } from '../src/lib/titles/model';
import type { ScreenshotBlobStore } from '../src/lib/screenshots/blobStore';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const comment = (domain: string, id: string, fields: Partial<DbComment> = {}): DbComment => ({
    id, domain, path: '/page', position: { type: 'page' },
    thread: { items: [{ id: 'first', text: 'The checkout fails', authorId: 'owner', createdAt: '2026-01-01T00:00:00Z' }] },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', authorId: 'owner', ...fields
});

function queryContainer(pages: { resources: CommentQueryCandidate[]; requestCharge?: number }[]) {
    let page = 0;
    const queries: { input: SqlQuerySpec; options: { partitionKey: string; maxItemCount: number; abortSignal: AbortSignal } }[] = [];
    const container = { id: 'comments-preview', items: { query(input: SqlQuerySpec, options: typeof queries[number]['options']) {
        queries.push({ input, options });
        return { hasMoreResults: () => page < pages.length, async fetchNext() { return structuredClone(pages[page++]); } };
    } } } as unknown as Container;
    return { container, queries, pagesRead: () => page };
}

test('Cosmos source drains more than 1000 rows and empty continuation pages with mandatory authorization in SQL', async () => {
    const domain = `query-${randomUUID()}`;
    const candidates = Array.from({ length: 1201 }, (_, index) => toCommentQueryCandidate(comment(domain, String(index)), String(index)));
    const fake = queryContainer([{ resources: candidates.slice(0, 1000), requestCharge: 2 }, { resources: [], requestCharge: 1 },
        { resources: candidates.slice(1000), requestCharge: 2 }]);
    const rows = await createCosmosCommentsStore(() => fake.container).queryCandidates(domain, {
        visibility: { authorId: 'viewer', privatePath: '/app' }, origin: { origins: ['https://production.example'] }, archive: 'exclude',
        predicate: { clause: 'c.priority = @q0 OR c.number = @q1', parameters: [{ name: '@q0', value: 'urgent' }, { name: '@q1', value: 4 }], test: () => true }
    });
    expect(rows).toHaveLength(1201);
    expect(fake.pagesRead()).toBe(3);
    const query = fake.queries[0]!;
    expect(query.options).toMatchObject({ partitionKey: domain, maxItemCount: 100 });
    expect(query.options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(query.input.query).not.toMatch(/\bTOP\b|SELECT\s+\*/i);
    expect(query.input.query).toContain('WHERE c.domain = @domain AND IS_STRING(c.path) AND (NOT (');
    expect(query.input.query).toContain('OR c.authorId = @readerId)');
    expect(query.input.query).toContain('AND NOT IS_STRING(c.archivedAt) AND (c.priority = @q0 OR c.number = @q1)');
    expect(query.input.parameters).toContainEqual({ name: '@readerId', value: 'viewer' });
    expect(query.input.parameters).toContainEqual({ name: '@domain', value: domain });
    expect(query.input.parameters).toContainEqual({ name: '@origins', value: ['https://production.example'] });
    // The projection can test screenshot existence, but cannot return its bytes or private blob path.
    const projection = query.input.query!.slice(0, query.input.query!.lastIndexOf(' FROM c WHERE'));
    expect(projection).not.toMatch(/c\.history|c\.pullRequests|\.data\b|\.blob\b|\.connector\b|\.sessionId\b|\.integrationSource\b/);
});

test('source resource limits reject complete results instead of returning a truncated match set', async () => {
    const domain = `query-${randomUUID()}`;
    const rows = ['a', 'b'].map(id => toCommentQueryCandidate(comment(domain, id), '1'));
    for (const limit of [{ maxCandidates: 1 }, { maxBytes: 1 }, { maxRequestCharge: 1 }]) {
        const fake = queryContainer([{ resources: rows, requestCharge: 2 }]);
        await expect(createCosmosCommentsStore(() => fake.container).queryCandidates(domain, limit)).rejects.toBeInstanceOf(CommentQueryBudgetError);
    }
    const fake = queryContainer([{ resources: rows }]);
    const store = createCosmosCommentsStore(() => fake.container);
    await expect(store.queryCandidates(domain, { predicate: { clause: 'true', parameters: [{ name: '@domain', value: 'other' }], test: () => true } })).rejects.toThrow('Invalid server query predicate');
    const abort = new AbortController();
    abort.abort(new Error('cancelled by caller'));
    await expect(store.queryCandidates(domain, { signal: abort.signal })).rejects.toThrow('cancelled by caller');
    expect(fake.queries).toHaveLength(0);
    const timeoutContainer = { id: 'comments-preview', items: { query(_input: unknown, options: { abortSignal: AbortSignal }) {
        return { hasMoreResults: () => true, async fetchNext() {
            return new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true }));
        } };
    } } } as unknown as Container;
    await expect(createCosmosCommentsStore(() => timeoutContainer).queryCandidates(domain, { maxDurationMs: 5 })).rejects.toBeInstanceOf(CommentQueryBudgetError);
});

test('memory source applies privacy, origin, archive and predicate before a candidate budget', async () => {
    const domain = `query-${randomUUID()}`, store = getMemoryCommentsStore();
    const records = [
        comment(domain, 'hidden', { private: true, origin: 'https://live.example' }),
        comment(domain, 'private-path', { path: '/app?tab=one', origin: 'https://live.example' }),
        comment(domain, 'other-origin', { origin: 'https://preview.example' }),
        comment(domain, 'archived', { origin: 'https://live.example', archivedAt: '2026-01-03T00:00:00Z' }),
        comment(domain, 'rejected', { origin: 'https://live.example', priority: 'low' }),
        comment(domain, 'own-hidden', { origin: 'https://live.example', private: true, authorId: 'viewer', priority: 'urgent' })
    ];
    try {
        for (const record of records) await store.create(record);
        const options = { visibility: { authorId: 'viewer', privatePath: '/app' }, origin: { origins: ['https://live.example'] }, archive: 'exclude' as const,
            maxCandidates: 1, predicate: { clause: 'c.priority = @q0', parameters: [{ name: '@q0', value: 'urgent' }], test: (row: CommentQueryCandidate) => row.priority === 'urgent' } };
        const selected = await store.queryCandidates(domain, options);
        expect(selected.map(row => row.id)).toEqual(['own-hidden']);
        // Both adapters expose the same candidate contract, including metadata and opaque revisions.
        const fake = queryContainer([{ resources: selected }]);
        expect(await createCosmosCommentsStore(() => fake.container).queryCandidates(domain, options)).toEqual(selected);
        await expect(store.queryCandidates(domain, { maxCandidates: 1 })).rejects.toBeInstanceOf(CommentQueryBudgetError);
        await expect(store.queryCandidates(domain, { maxBytes: 1 })).rejects.toBeInstanceOf(CommentQueryBudgetError);
    } finally {
        for (const record of records) { const current = await store.get(domain, record.id); if (current) await store.delete(domain, record.id, current.etag); }
    }
});

test('candidates omit pixels, audit events, connector credentials and deleted content', async () => {
    const domain = `query-${randomUUID()}`;
    const record = comment(domain, 'safe', {
        history: [{ secret: 'history-secret' }] as unknown as DbComment['history'],
        screenshot: { contentType: 'image/png', width: 10, height: 20, bytes: 100 },
        assigneeIds: ['member'], assigneeAgent: { kind: 'codex', assigneeId: 'member', setBy: 'member', setAt: 'now',
            sessionId: 'session-secret', connector: { credentialId: 'credential-secret', name: 'client' } },
        thread: { items: [{ id: 'first', text: 'visible', authorId: 'member', agent: { credentialId: 'message-secret', name: 'tool' } },
            { id: 'deleted', text: 'deleted-secret', quotedText: 'quote-secret', authorId: 'author-secret', mentions: [{ userId: 'mention-secret', start: 0, end: 1 }], deletedAt: '2026-01-02T00:00:00Z' }] }
    });
    const candidate = toCommentQueryCandidate(record, 'opaque');
    expect(candidate.hasScreenshot).toBe(true);
    expect(candidate.thread.items[1]).toEqual({ id: 'deleted', text: '', deletedAt: '2026-01-02T00:00:00Z' });
    expect(candidate.assigneeAgent).toEqual({ kind: 'codex', assigneeId: 'member' });
    expect(JSON.stringify(candidate)).not.toMatch(/history-secret|session-secret|credential-secret|message-secret|deleted-secret|quote-secret|author-secret|mention-secret|"screenshot"/);
});

test('metadata normalizes legacy fields without indexing mutable names or stale titles', async () => {
    const record = comment('domain', 'legacy', {
        assigneeId: 'member', assigneeAgent: { kind: 'codex', assigneeId: 'member', setBy: 'member', setAt: 'now' },
        updatedAt: undefined, createdAt: '2026-01-01T02:00:00+02:00',
        aiTitle: { text: 'Current title', source: aiTitleSource('The checkout fails'), model: 'model', generatedAt: 'now', cleanup: 2 }
    });
    expect(commentQueryMetadata(record)).toMatchObject({ version: 1, status: 'open', priority: 'normal', priorityRank: 2,
        created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', completedMissing: true, archivedMissing: true,
        assigneeIds: ['member'], agentKinds: ['codex'], aiTitle: 'Current title' });
    expect(commentQueryMetadata(record).searchText).not.toContain('current title');
    expect(commentQueryMetadata({ ...record, assigneeIds: [], thread: { items: [{ id: 'first', text: 'edited' }] } })).toMatchObject({ assigneeIds: [], agentKinds: [] });
    expect(commentQueryMetadata({ ...record, thread: { items: [{ id: 'first', text: 'edited' }] } }).aiTitle).toBeUndefined();
    expect(commentQueryMetadata(toCommentQueryCandidate(record, '1'))).toEqual(commentQueryMetadata(record));
    const emptyAgents = toCommentQueryCandidate({ ...record, assigneeAgents: [] }, '1');
    expect(normalizeCandidate(emptyAgents).assigneeAgents).toEqual([]);
    const legacy = { ...toCommentQueryCandidate(record, '1'), assigneeAgents: null } as unknown as CommentQueryCandidate;
    expect(normalizeCandidate(legacy)).not.toHaveProperty('assigneeAgents');
    expect(commentQueryMetadata(legacy).agentKinds).toEqual(['codex']);
});

test('every memory canonical write refreshes metadata, including replies and atomic receipts and screenshots', async () => {
    const domain = `query-${randomUUID()}`, store = getMemoryCommentsStore();
    const record = comment(domain, 'canonical');
    const metadata = async () => (await store.queryCandidates(domain)).find(row => row.id === record.id)?.queryMetadata;
    try {
        await store.create(record);
        let saved = (await store.get(domain, record.id))!;
        expect(saved.comment).not.toHaveProperty('queryMetadata');
        expect(await metadata()).toMatchObject({ version: 1, replyCount: 0, status: 'open' });
        const changed = { ...saved.comment, priority: 'urgent' as const, resolved: true, completedAt: '2026-01-02T00:00:00Z',
            queryMetadata: { ...(await metadata())!, priority: 'low' as const } };
        expect(await store.replace(changed, saved.etag)).toBe('ok');
        saved = (await store.get(domain, record.id))!;
        expect(await metadata()).toMatchObject({ priority: 'urgent', status: 'done', completedMissing: false });
        expect(await store.appendThreadItem(domain, record.id, { id: 'reply', text: 'follow-up', authorId: 'reviewer',
            mentions: [{ userId: 'member', start: 0, end: 1 }] }, 100, '2026-01-03T00:00:00Z')).toBe('ok');
        saved = (await store.get(domain, record.id))!;
        expect(await metadata()).toMatchObject({ replyCount: 1, mentionIds: ['member'], authorIds: ['owner', 'reviewer'] });
        expect((await metadata())?.searchText).toContain('follow-up');
        const receipt = { id: 'receipt', domain, type: 'submission' } as DbSubmission;
        expect(await store.commitSubmission(receipt, { ...saved.comment, archivedAt: '2026-01-04T00:00:00Z' }, saved.etag)).toBe('ok');
        saved = (await store.get(domain, record.id))!;
        expect(await metadata()).toMatchObject({ archivedMissing: false, archived: '2026-01-04T00:00:00.000Z' });
        const screenshot: DbScreenshot = { id: screenshotDocumentId(record.id), domain, commentId: record.id, type: 'screenshot',
            createdAt: '2026-01-05T00:00:00Z', contentType: 'image/png', width: 10, height: 20, bytes: 1, data: 'eA==' };
        expect(await store.replaceScreenshot({ ...saved.comment, screenshot }, saved.etag, screenshot)).toBe('ok');
        expect((await metadata())?.hasScreenshot).toBe(true);
    } finally {
        const saved = await store.get(domain, record.id); if (saved) await store.delete(domain, record.id, saved.etag);
        await store.deleteScreenshot(domain, record.id);
    }
});

test('internal query metadata stays out of ordinary canonical and worker read payloads', async () => {
    const domain = `query-${randomUUID()}`, memory = getMemoryCommentsStore();
    const record = comment(domain, 'canonical-shape', { projectId: 'project', syncPending: true, notificationPending: true });
    const persisted = { ...record, queryMetadata: commentQueryMetadata(record), _etag: 'etag' };
    const container = { id: 'comments-preview', items: { query() {
        let pending = true;
        return { hasMoreResults: () => pending, async fetchNext() { pending = false; return { resources: [structuredClone(persisted)] }; } };
    } }, item() { return { async read() { return { resource: structuredClone(persisted), etag: 'etag' }; } }; } } as unknown as Container;
    try {
        await memory.create(record);
        for (const store of [memory, createCosmosCommentsStore(() => container)]) {
            expect((await store.get(domain, record.id))?.comment).not.toHaveProperty('queryMetadata');
            expect((await store.list(domain, '/page', 10))[0]).not.toHaveProperty('queryMetadata');
            expect((await store.listAll(domain, 10))[0]).not.toHaveProperty('queryMetadata');
            expect((await store.listChangedSince(domain, 0, 10))[0]?.comment).not.toHaveProperty('queryMetadata');
            expect((await store.listSyncPending()).find(row => row.id === record.id)).not.toHaveProperty('queryMetadata');
            expect((await store.listNotificationPending()).find(row => row.id === record.id)).not.toHaveProperty('queryMetadata');
        }
        expect((await memory.queryCandidates(domain))[0]?.queryMetadata).toMatchObject({ version: 1 });
    } finally {
        const current = await memory.get(domain, record.id); if (current) await memory.delete(domain, record.id, current.etag);
    }
});

test('Cosmos metadata is in the same conditional write and transaction as canonical fields', async () => {
    const domain = `query-${randomUUID()}`, record = comment(domain, 'canonical');
    const writes: DbComment[] = [], batches: { operationType: string; resourceBody?: DbComment }[][] = [];
    const container = { id: 'comments-preview', items: {
        async create(document: DbComment) { writes.push(document); },
        async batch(operations: typeof batches[number]) { batches.push(operations); return { code: 200, result: operations.map(() => ({ statusCode: 200 })) }; }
    }, item() { return {
        async read() { return { resource: record, etag: 'etag' }; },
        async replace(document: DbComment, options: unknown) { expect(options).toEqual({ accessCondition: { type: 'IfMatch', condition: 'etag' } }); writes.push(document); }
    }; } } as unknown as Container;
    const blobs = { put: async () => 'private-blob', delete: async () => {} } as unknown as ScreenshotBlobStore;
    const store = createCosmosCommentsStore(() => container, () => blobs);
    await store.create(record);
    await store.replace({ ...record, priority: 'high' }, 'etag');
    await store.appendThreadItem(domain, record.id, { id: 'reply', text: 'reply' }, 10, '2026-01-02T00:00:00Z');
    expect(writes.map(write => write.queryMetadata?.replyCount)).toEqual([0, 0, 1]);
    expect(writes[1]?.queryMetadata?.priority).toBe('high');
    await store.commitSubmission({ id: 'receipt', domain, type: 'submission' } as DbSubmission, { ...record, resolved: true }, 'etag');
    const screenshot: DbScreenshot = { id: screenshotDocumentId(record.id), domain, commentId: record.id, type: 'screenshot',
        createdAt: '2026-01-03T00:00:00Z', contentType: 'image/png', width: 10, height: 20, bytes: 1, data: 'eA==' };
    await store.replaceScreenshot({ ...record, screenshot }, 'etag', screenshot);
    expect(batches[0]?.[1]?.resourceBody?.queryMetadata?.status).toBe('done');
    expect(batches[1]?.[0]?.resourceBody?.queryMetadata?.hasScreenshot).toBe(true);
    expect(batches[1]?.[1]?.resourceBody).not.toHaveProperty('data');
});
