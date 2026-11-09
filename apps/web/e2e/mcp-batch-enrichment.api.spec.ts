import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createProjectFeedbackExportReader, projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { findOrCreateUser, updateUserName } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { userPk, workspacePk, type AppDoc, type DbWorkspace } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import type { ProjectActor } from '../src/lib/review/actor';
import { createProjectComment } from '../src/lib/review/comments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import type { DbComment } from '../src/lib/db/schema';
import { aiTitleSource } from '../src/lib/titles/model';

const base = 'http://127.0.0.1:6514';
const original = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET, UIER_BASE_URL: process.env.UIER_BASE_URL };
test.beforeAll(() => Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'batch-enrichment-local-only-secret', UIER_BASE_URL: base }));
test.afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

async function fixture() {
    const user = await findOrCreateUser(`batch-enrichment-${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Batch exports', urls: ['https://reviewed.example'] });
    const actor: ProjectActor = { kind: 'member', userId: user.id, name: user.name, isAdmin: true };
    const first = await createProjectComment(new Request(base), project, actor, {
        origin: 'https://reviewed.example', path: '/pricing', kind: 'feedback', position: { type: 'page' }, text: 'A batch export with a current title'
    });
    const comments: DbComment[] = [];
    for (let index = 0; index < 10; index++) {
        const comment: DbComment = { ...first, id: `comment_${randomUUID()}`, number: undefined,
            aiTitle: { text: 'Current batch title', source: aiTitleSource(first.thread.items[0]!.text), model: 'test', generatedAt: new Date().toISOString(), cleanup: 2 } };
        await getCommentsStore().create(comment);
        comments.push(comment);
    }
    return { user, project, actor, comments };
}

/** Count the actual memory-store get/query boundaries, without replacing the export services. */
function countReads(f: Awaited<ReturnType<typeof fixture>>) {
    const memory = (globalThis as typeof globalThis & {
        __uierAppMemoryStore: { partitions: Map<string, Map<string, { doc: AppDoc }>> }
    }).__uierAppMemoryStore;
    const reads = { users: 0, project: 0, workspace: 0, workspaceQueries: 0 };
    const user = memory.partitions.get(userPk(f.user.id))!;
    const workspace = memory.partitions.get(workspacePk(f.project.workspaceId))!;
    const userGet = user.get, workspaceGet = workspace.get, workspaceValues = workspace.values;
    user.get = function (id) { reads.users++; return userGet.call(this, id); };
    workspace.get = function (id) {
        if (id === f.project.id) reads.project++;
        if (id === f.project.workspaceId) reads.workspace++;
        return workspaceGet.call(this, id);
    };
    workspace.values = function () { reads.workspaceQueries++; return workspaceValues.call(this); };
    return { reads, restore() { user.get = userGet; workspace.get = workspaceGet; workspace.values = workspaceValues; } };
}

test('one batch shares enrichment reads while preserving the same ten full packets', async ({}, testInfo) => {
    const f = await fixture();
    const singleReads = countReads(f);
    const before = [];
    const baselineStart = performance.now();
    try {
        for (const comment of f.comments) before.push(await projectFeedbackExport(f.project, f.actor, comment.id, undefined, base));
    } finally { singleReads.restore(); }
    const baselineMs = performance.now() - baselineStart;
    const batchReads = countReads(f);
    const after = [];
    const batchStart = performance.now();
    try {
        const read = createProjectFeedbackExportReader(f.project, f.actor, undefined, base);
        for (const comment of f.comments) after.push(await read(comment.id));
    } finally { batchReads.restore(); }
    const batchMs = performance.now() - batchStart;
    expect(after).toEqual(before);
    // A batch of ten repeated authors uses one author lookup and one project-members lookup.
    expect(singleReads.reads).toEqual({ users: 20, project: 10, workspace: 10, workspaceQueries: 20 });
    expect(batchReads.reads).toEqual({ users: 2, project: 1, workspace: 1, workspaceQueries: 2 });
    await testInfo.attach('batch-enrichment-read-comparison', { contentType: 'application/json', body: JSON.stringify({
        fixture: '10 visible threads, one current author/member, stored titles; in-memory services',
        unshared: { reads: singleReads.reads, elapsedMs: baselineMs }, shared: { reads: batchReads.reads, elapsedMs: batchMs },
        scope: 'Packet enrichment only; real Cosmos RU and hosted latency are not measured.'
    }, null, 2) });
});

test('every packet checks visibility and a new request reloads names and title settings', async () => {
    const f = await fixture();
    const actor: ProjectActor = { kind: 'member', userId: 'u_another-current-member', name: 'Reviewer', isAdmin: false };
    const read = createProjectFeedbackExportReader(f.project, actor, undefined, base);
    const first = f.comments[0]!;
    expect((await read(first.id)).context.title).toBe('Current batch title');
    const stored = (await getCommentsStore().get(first.domain, first.id))!;
    await getCommentsStore().replace({ ...stored.comment, private: true }, stored.etag);
    await expect(read(first.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(read('comment_missing')).rejects.toMatchObject({ code: 'not_found' });
    await updateUserName(f.user.id, 'Renamed author');
    const workspace = (await getAppStore().get<DbWorkspace>(workspacePk(f.project.workspaceId), f.project.workspaceId))!;
    await getAppStore().replace({ ...workspace.doc, aiTitles: false }, workspace.etag);
    const nextRequest = createProjectFeedbackExportReader(f.project, f.actor, undefined, base);
    const packet = await nextRequest(f.comments[1]!.id);
    expect(JSON.stringify(packet)).toContain('Renamed author');
    expect(packet.context.title).toBe('A batch export with a current title');
});
