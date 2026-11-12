import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadAppCommentsSnapshot } from '../src/lib/app/appCommentsSnapshot';
import type { AppContext } from '../src/lib/app/context';
import type { DbProject } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { parseCommentsQuery } from '../src/components/app/comments/commentsQuery';
import { persistProjectAccess } from './support/projectAccess';

test('large seeded project measures the initial board and list payloads', async ({}, testInfo) => {
    process.env.UIER_LOCAL = '1';
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12), aiTitles: 'off' } as DbProject);
    const context = { user: { id: 'admin', name: 'Admin' }, workspace: { id: project.workspaceId, aiTitles: false }, isAdmin: true } as AppContext;
    const store = getCommentsStore(), domain = `project:${project.id}`;
    const now = '2026-01-01T00:00:00.000Z';
    for (let i = 0; i < 2000; i++) await store.create({ id: `bench-${String(i).padStart(5, '0')}`, domain, projectId: project.id,
        path: `/page-${i % 20}`, origin: project.urls[0], number: i + 1, position: { type: 'page' },
        resolved: i % 4 === 3, inProgress: i % 4 === 1, ...(i % 5 === 0 ? { archivedAt: now } : {}),
        ...(i % 4 === 2 ? { verification: { id: 'verification', revision: 'v1', requester: 'user:admin', reviewer: 'user:member', requestedAt: now, outcome: 'pending' as const } } : {}),
        createdAt: now, updatedAt: now, authorId: 'user:member',
        thread: { items: Array.from({ length: 11 }, (_, j) => ({ id: `message-${j}`, text: `Feedback ${i} message ${j}. ${'Context for a long discussion. '.repeat(20)}`, authorId: 'user:member', createdAt: now })) }
    });
    const results = [];
    for (const view of ['board', 'list'] as const) {
        const samples = [];
        let snapshot!: NonNullable<Awaited<ReturnType<typeof loadAppCommentsSnapshot>>>;
        for (let run = 0; run < 5; run++) {
            const start = performance.now();
            snapshot = (await loadAppCommentsSnapshot(context, project, parseCommentsQuery({ view })))!;
            samples.push(performance.now() - start);
        }
        const result = { view, seededThreads: 2000, messagesPerThread: 11, returnedRows: snapshot.comments.length,
            jsonBytes: Buffer.byteLength(JSON.stringify(snapshot)), durationsMs: samples.map(time => Math.round(time * 100) / 100) };
        results.push(result);
        expect(snapshot.comments.length).toBe(view === 'board' ? 100 : 25);
        expect(snapshot.paging.scopeTotal).toBe(2000);
        expect(snapshot.paging.statusCounts.all).toBe(1600);
        expect(snapshot.paging.statusCounts.archived).toBe(400);
        expect(result.jsonBytes).toBeLessThan(view === 'board' ? 300_000 : 100_000);
    }
    console.info('PAGING_BENCHMARK', JSON.stringify(results));
    await testInfo.attach('paging-benchmark.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});
