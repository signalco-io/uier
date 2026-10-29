import { randomUUID } from 'node:crypto';
import type { Container, OperationInput } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { findOrCreateUser } from '../src/lib/app/users';
import { toCommentDto } from '../src/lib/comments/dto';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { ensurePublicProject, PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION } from '../src/lib/comments/publicProject';
import { isCommentDocument, syncTombstoneId, type DbComment, type DbSyncTombstone } from '../src/lib/db/schema';
import { hasIntegrationBindings, integrationTargets, syncPendingKey, syncTombstone, withSyncMark } from '../src/lib/integrations/syncSignal';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { createProjectComment, deleteProjectCommentItem, editProjectCommentItem, editProjectCommentText, reattachProjectAnchor,
    removeProjectComment, replaceProjectScreenshot, replyToProjectComment, setProjectCommentAssignee,
    setProjectCommentPrivate, setProjectCommentResolved } from '../src/lib/review/comments';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { pngImage } from './support/images';

const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });
const request = new Request('http://127.0.0.1/api/review');
const origin = 'https://reviewed.example';
const point = { type: 'point' as const, selector: 'h1', xNormal: 0.5, yNormal: 0.5 };

async function fixture(connected = true) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`integration-owner-${id}@example.com`);
    const member = await findOrCreateUser(`integration-member-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const now = new Date().toISOString();
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: 'Integration signals',
        urls: [origin], status: 'active', access: 'guests', createdBy: owner.id, createdAt: now, updatedAt: now,
        ...(connected ? { integrations: { notion: { connectionId: `notion_${id}`, since: now }, slack: { connectionId: `slack_${id}`, since: now } } } : {}) };
    const app = getAppStore();
    await app.create(project);
    await app.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [user, role] of [[owner, 'admin'], [member, 'commenter']] as const)
        await app.create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id,
            email: user.email, role, projects: 'all', createdAt: now });
    const admin = (await memberActor(project, owner.id))!;
    const reviewer = (await memberActor(project, member.id))!;
    const guest: ProjectActor = { kind: 'guest', visitorId: `guest-${id}` };
    const input = { text: 'Saved feedback', origin, path: '/page', position: point, kind: 'feedback' as const };
    return { project, admin, reviewer, guest, owner, member, input, store: getMemoryCommentsStore() };
}

async function pendingFor(domain: string) {
    return (await getMemoryCommentsStore().listSyncPending({ after: `${domain}:`, limit: 1000 })).filter(doc => doc.domain === domain);
}

function source(project: DbProject, changes: Partial<DbComment> = {}): DbComment {
    return { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        path: '/page', position: point, thread: { items: [{ id: 'item_first', text: 'Untrusted feedback' }] }, ...changes };
}

test('one shared state signal ignores stale bindings and enforces identity, private transitions and public-project exclusion', async () => {
    const f = await fixture();
    const comment = source(f.project);
    expect(integrationTargets(f.project)).toEqual([
        { provider: 'notion', connectionId: `notion_${f.project.id}` }, { provider: 'slack', connectionId: `slack_${f.project.id}` }
    ]);
    const marked = withSyncMark(f.project, null, comment);
    expect(marked).toMatchObject({ syncVersion: 1, syncPending: true });
    expect(withSyncMark(f.project, marked, marked)).toBe(marked);
    expect(withSyncMark({ ...f.project, integrations: undefined }, null, comment)).toMatchObject({ syncVersion: 1, syncPending: true });
    const invalid = { ...f.project, integrations: { unknown: { connectionId: 'bad' }, notion: { connectionId: '' } } } as unknown as DbProject;
    expect(hasIntegrationBindings(invalid)).toBe(false);
    const privateComment = { ...comment, private: true };
    expect(withSyncMark(f.project, null, privateComment)).toBe(privateComment);
    expect(withSyncMark(f.project, privateComment, { ...privateComment, resolved: true })).not.toHaveProperty('syncVersion');
    expect(withSyncMark(f.project, marked, { ...marked, private: true })).toMatchObject({ syncVersion: 2, syncPending: true });
    expect(withSyncMark(f.project, { ...marked, private: true }, { ...marked, private: false })).toMatchObject({ syncVersion: 2 });
    const publicProject = { ...f.project, id: PUBLIC_PROJECT_ID };
    const appFeedback = source(publicProject, { domain: PUBLIC_PROJECT_PARTITION, path: '/app/projects' });
    expect(hasIntegrationBindings(publicProject)).toBe(false);
    expect(withSyncMark(publicProject, null, appFeedback)).toBe(appFeedback);
    expect(withSyncMark(f.project, null, source({ ...f.project, id: 'foreign' }))).not.toHaveProperty('syncPending');
    expect(withSyncMark(f.project, null, { ...comment, domain: 'legacy.example' })).not.toHaveProperty('syncPending');
    expect(withSyncMark(f.project, null, { ...comment, projectId: undefined })).toMatchObject({ projectId: f.project.id, syncVersion: 1, syncPending: true });
    expect(() => syncTombstone(f.project, { ...comment, domain: 'foreign.example' })).toThrow('matching project');
    expect(() => syncTombstone(f.project, { ...comment, projectId: 'foreign' })).toThrow('matching project');
    expect(syncTombstone(f.project, { ...comment, projectId: undefined })).toMatchObject({ projectId: f.project.id });
});

test('project services mark each content/status/assignment mutation once and leave email metadata independent', async () => {
    const f = await fixture();
    let expected = 1;
    let comment = await createProjectComment(request, f.project, f.admin, f.input);
    const check = async (result: DbComment) => {
        const saved = (await f.store.get(result.domain, result.id))!.comment;
        expect(saved.syncVersion).toBe(expected);
        expect(saved.syncPending).toBe(true);
        expect(saved.notificationPending).toBe(true);
        comment = saved;
    };
    await check(comment);
    expect(comment.notificationEvents).toHaveLength(1);
    expected++;
    await check(await replyToProjectComment(request, f.project, f.reviewer, comment.id, { text: 'Saved reply' }));
    const replyId = comment.thread.items[1]!.id;
    expected++;
    await check(await setProjectCommentResolved(f.project, f.admin, comment.id, true));
    await check(await setProjectCommentResolved(f.project, f.admin, comment.id, true));
    expected++;
    await check(await setProjectCommentAssignee(f.project, f.admin, comment.id, f.member.id));
    await check(await setProjectCommentAssignee(f.project, f.admin, comment.id, f.member.id));
    expected++;
    await check(await editProjectCommentText(f.project, f.admin, comment.id, 'Edited first feedback'));
    await check(await editProjectCommentText(f.project, f.admin, comment.id, 'Edited first feedback'));
    expected++;
    await check(await editProjectCommentItem(f.project, f.reviewer, comment.id, replyId, { expectedText: 'Saved reply', text: 'Edited reply' }));
    expected++;
    await check((await deleteProjectCommentItem(f.project, f.reviewer, comment.id, replyId))!);
    // Silent edits/deletes do not invent email events or borrow their activity sequence as a sync cursor.
    expect(comment.syncVersion).toBeGreaterThan(comment.activity!.sequence);
    expect(comment.notificationEvents?.map(event => event.kind)).toEqual(['comment', 'reply', 'resolved', 'assignment']);
    const unbound = await fixture(false);
    const plain = await createProjectComment(request, unbound.project, unbound.admin, unbound.input);
    expect(plain).toMatchObject({ syncVersion: 1, syncPending: true });
    expect((await replyToProjectComment(request, unbound.project, unbound.admin, plain.id, { text: 'Unbound reply' }))).toMatchObject({ syncVersion: 2, syncPending: true });
});

test('idempotent retries and concurrent writes share the etag signal rather than double-counting', async () => {
    const f = await fixture();
    const input = { ...f.input, idempotencyKey: randomUUID() };
    const created = await Promise.all([createProjectComment(request, f.project, f.admin, input), createProjectComment(request, f.project, f.admin, input)]);
    expect(created[0]!.id).toBe(created[1]!.id);
    expect(created[0]!.syncVersion).toBe(1);
    const id = created[0]!.id;
    const reply = { text: 'Exactly one connector reply', idempotencyKey: randomUUID() };
    const agent = { ...f.reviewer, kind: 'member' as const, agent: { credentialId: 'test-credential', name: 'Test coding tool' } } as ProjectActor;
    await Promise.all([replyToProjectComment(request, f.project, agent, id, reply), replyToProjectComment(request, f.project, agent, id, reply)]);
    const afterReply = (await f.store.get(created[0]!.domain, id))!.comment;
    expect(afterReply.syncVersion).toBe(2);
    expect(afterReply.thread.items).toHaveLength(2);
    expect(afterReply.thread.items[1]!.agent).toMatchObject({ credentialId: 'test-credential' });
    const statusKey = randomUUID();
    await Promise.all([setProjectCommentResolved(f.project, f.admin, id, true, statusKey), setProjectCommentResolved(f.project, f.admin, id, true, statusKey)]);
    await Promise.all([
        replyToProjectComment(request, f.project, f.admin, id, { text: 'Concurrent first reply' }),
        replyToProjectComment(request, f.project, f.reviewer, id, { text: 'Concurrent second reply' })
    ]);
    const saved = (await f.store.get(created[0]!.domain, id))!.comment;
    expect(saved.syncVersion).toBe(5);
    expect(saved.thread.items).toHaveLength(4);
    expect(saved.notificationEvents).toHaveLength(5);
});

test('private-to-private writes remain quiet while both privacy transitions are discoverable', async () => {
    const f = await fixture();
    const created = await createProjectComment(request, f.project, f.admin, f.input);
    const hidden = await setProjectCommentPrivate(f.project, f.admin, created.id, true);
    expect(hidden.syncVersion).toBe(2);
    const stored = (await f.store.get(hidden.domain, hidden.id))!;
    await f.store.replace({ ...stored.comment, syncPending: false }, stored.etag);
    const privateReply = await replyToProjectComment(request, f.project, f.admin, created.id, { text: 'Never exported private reply' });
    expect(privateReply).toMatchObject({ syncVersion: 2, syncPending: false });
    const noOp = await setProjectCommentPrivate(f.project, f.admin, created.id, true);
    expect(noOp).toMatchObject({ syncVersion: 2, syncPending: false });
    const visible = await setProjectCommentPrivate(f.project, f.admin, created.id, false);
    expect(visible).toMatchObject({ syncVersion: 3, syncPending: true });
    expect((await pendingFor(visible.domain)).find(doc => doc.id === visible.id)).toMatchObject({ syncVersion: 3 });
});

test('anchor and atomic screenshot replacements mark silent evidence changes, retaining their etag checks', async () => {
    const f = await fixture();
    const created = await createProjectComment(request, f.project, f.admin, f.input);
    const moved = await reattachProjectAnchor(f.project, f.admin, created.id, origin, {
        path: f.input.path, position: { ...point, selector: 'h2' }, expectedRevision: null
    });
    expect(moved.syncVersion).toBe(2);
    const screenshot = parseScreenshot(pngImage) as ParsedScreenshot;
    const captured = await replaceProjectScreenshot(f.project, f.admin, created.id, { screenshot, expectedRevision: null });
    expect(captured.syncVersion).toBe(3);
    expect((await f.store.getScreenshot(created.domain, created.id))!.revision).toBe(captured.screenshot!.revision);
    await expect(replaceProjectScreenshot(f.project, f.admin, created.id, { screenshot, expectedRevision: 'stale' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.store.get(created.domain, created.id))!.comment.syncVersion).toBe(3);
});

test('hard delete atomically preserves only deletion identity and guards discovery acknowledgement', async () => {
    const f = await fixture();
    const created = await createProjectComment(request, f.project, f.admin, f.input);
    const old = (await f.store.get(created.domain, created.id))!;
    await replyToProjectComment(request, f.project, f.reviewer, created.id, { text: 'Concurrent content survives stale delete' });
    expect(await f.store.deleteWithTombstone(created.domain, created.id, old.etag, syncTombstone(f.project, created))).toBe('conflict');
    expect((await pendingFor(created.domain)).some(doc => doc.id === syncTombstoneId(created.id))).toBe(false);
    expect((await f.store.get(created.domain, created.id))!.comment.thread.items).toHaveLength(2);
    await removeProjectComment(f.project, f.admin, created.id);
    const tombstone = (await pendingFor(created.domain)).find(doc => doc.id === syncTombstoneId(created.id)) as DbSyncTombstone;
    expect(tombstone).toMatchObject({ type: 'tombstone', commentId: created.id, projectId: f.project.id, syncVersion: 3, syncPending: true, ttl: 2592000 });
    expect(tombstone.targets).toEqual(integrationTargets(f.project));
    for (const field of ['path', 'thread', 'text', 'screenshot', 'authorId', 'authorName', 'device']) expect(tombstone).not.toHaveProperty(field);
    expect(JSON.stringify(tombstone)).not.toContain('Saved feedback');
    expect(isCommentDocument({ ...tombstone, path: '/wrong' })).toBe(false);
    expect(await f.store.get(created.domain, created.id)).toBeNull();
    expect(await f.store.get(created.domain, tombstone.id)).toBeNull();
    expect(await f.store.listAll(created.domain, 1000)).toEqual([]);
    expect(await f.store.list(created.domain, '/page', 1000)).toEqual([]);
    expect(await f.store.listActivity(created.domain)).toEqual([]);
    expect((await f.store.listNotificationPending()).some(doc => doc.id === tombstone.id)).toBe(false);
    expect(await f.store.deleteTombstone(created.domain, created.id, 2)).toBe('conflict');
    expect(await f.store.deleteTombstone(created.domain, created.id, 3)).toBe('ok');
    expect(await f.store.deleteTombstone(created.domain, created.id, 3)).toBe('not_found');
});

test('author deletion placeholders and final reply removal keep their own sync versions and tombstone', async () => {
    const f = await fixture();
    const created = await createProjectComment(request, f.project, f.guest, f.input);
    const replied = await replyToProjectComment(request, f.project, f.reviewer, created.id, { text: 'Keep another author reply' });
    const kept = (await deleteProjectCommentItem(f.project, f.guest, created.id, created.thread.items[0]!.id))!;
    expect(kept.syncVersion).toBe(3);
    expect(kept.thread.items[0]).toMatchObject({ text: '', deletedAt: expect.any(String) });
    expect(await deleteProjectCommentItem(f.project, f.reviewer, created.id, replied.thread.items[1]!.id)).toBeNull();
    const tombstone = (await pendingFor(created.domain)).find(doc => doc.id === syncTombstoneId(created.id));
    expect(tombstone).toMatchObject({ syncVersion: 4, type: 'tombstone' });
});

test('sync fields and binding identities never leak through either comment DTO', async () => {
    const f = await fixture();
    const created = await createProjectComment(request, f.project, f.admin, f.input);
    const publicDto = toCommentDto(created, `user:${f.owner.id}`);
    const memberDto = toReviewCommentDto(created, f.admin, new Map([[f.owner.id, 'Admin']]), f.project.urls, 0, new Map(), f.project);
    for (const dto of [publicDto, memberDto]) {
        expect(dto).not.toHaveProperty('syncVersion');
        expect(dto).not.toHaveProperty('syncPending');
        expect(dto).not.toHaveProperty('syncKey');
        expect(JSON.stringify(dto)).not.toContain(`notion_${f.project.id}`);
        expect(JSON.stringify(dto)).not.toContain(`slack_${f.project.id}`);
    }
});


test('Cosmos deletion uses one conditional partition batch and never retries as an unguarded delete', async () => {
    const f = await fixture();
    const comment = source(f.project, { syncVersion: 9 });
    const intent = syncTombstone(f.project, comment);
    const calls: { operations: OperationInput[]; partition: unknown }[] = [];
    let code = 200;
    const container = { items: { batch: async (operations: OperationInput[], partition: unknown) => {
        calls.push({ operations, partition });
        return { code, result: code === 200 ? [{ statusCode: 204 }, { statusCode: 200 }] : [{ statusCode: code }, { statusCode: 424 }] };
    } } } as unknown as Container;
    const store = createCosmosCommentsStore(() => container);
    expect(await store.deleteWithTombstone(comment.domain, comment.id, 'current-etag', intent)).toBe('ok');
    expect(calls).toEqual([{ partition: comment.domain, operations: [
        { operationType: 'Delete', id: comment.id, ifMatch: 'current-etag' },
        { operationType: 'Upsert', resourceBody: intent }
    ] }]);
    code = 412;
    expect(await store.deleteWithTombstone(comment.domain, comment.id, 'stale-etag', intent)).toBe('conflict');
    code = 404;
    expect(await store.deleteWithTombstone(comment.domain, comment.id, 'missing-etag', intent)).toBe('not_found');
    code = 500;
    await expect(store.deleteWithTombstone(comment.domain, comment.id, 'etag', intent)).rejects.toThrow('transaction failed');
    expect(calls).toHaveLength(4);
    await expect(store.deleteWithTombstone('foreign-partition', comment.id, 'etag', intent)).rejects.toThrow('does not match');
    expect(calls).toHaveLength(4);
});


test('a stale unbound project snapshot cannot lose changes or deletes while connection setup races it', async () => {
    const f = await fixture(false);
    const stale = structuredClone(f.project);
    const app = getAppStore();
    const stored = (await app.get<DbProject>(f.project.pk, f.project.id))!;
    const attached: DbProject = { ...stored.doc, integrations: {
        notion: { connectionId: `notion_${f.project.id}`, since: new Date().toISOString() }
    } };
    expect(await app.replace(attached, stored.etag)).toBe('ok');
    // The request resolved the project before setup committed, then wrote afterwards.
    const created = await createProjectComment(request, stale, f.admin, f.input);
    expect(created).toMatchObject({ syncVersion: 1, syncPending: true });
    const changed = await setProjectCommentResolved(stale, f.admin, created.id, true);
    expect(changed).toMatchObject({ syncVersion: 2, syncPending: true });
    await removeProjectComment(stale, f.admin, created.id);
    const pending = (await pendingFor(created.domain)).find(doc => doc.id === syncTombstoneId(created.id)) as DbSyncTombstone;
    expect(pending).toMatchObject({ syncVersion: 3, projectId: f.project.id, targets: [], syncPending: true });
    expect(await f.store.get(created.domain, created.id)).toBeNull();
    // Discovery adds the current binding to this captured empty target set; the intent survived.
    expect((await app.get<DbProject>(f.project.pk, f.project.id))!.doc.integrations).toEqual(attached.integrations);
});

test('unbound hard deletes retain intent while public-project deletions create no integration outbox', async () => {
    const f = await fixture(false);
    const created = await createProjectComment(request, f.project, f.admin, f.input);
    await removeProjectComment(f.project, f.admin, created.id);
    expect((await pendingFor(created.domain)).find(doc => doc.id === syncTombstoneId(created.id)))
        .toMatchObject({ targets: [], syncVersion: 2, type: 'tombstone' });
    const publicProject = await ensurePublicProject();
    const publicComment = source(publicProject, { domain: PUBLIC_PROJECT_PARTITION, authorId: `user:${f.owner.id}`,
        thread: { items: [{ id: 'first', text: 'Public showcase feedback', authorId: `user:${f.owner.id}` }] } });
    await f.store.create(publicComment);
    await removeProjectComment(publicProject, (await memberActor(publicProject, f.owner.id))!, publicComment.id);
    expect((await pendingFor(publicComment.domain)).some(doc => doc.id === syncTombstoneId(publicComment.id))).toBe(false);
});


test('outbox pages have stable bounded key ordering, tombstones, legacy fixture fallback and a forward cursor', async () => {
    const f = await fixture(false);
    const domain = `project:${f.project.id}`;
    const comments: DbComment[] = [];
    for (let i = 0; i < 1005; i++) comments.push(withSyncMark(f.project, null, source(f.project, { id: `comment_page_${String(i).padStart(4, '0')}` })));
    const legacy = source(f.project, { id: 'comment_legacy', syncVersion: 1, syncPending: true });
    comments.push(legacy);
    const toDelete = withSyncMark(f.project, null, source(f.project, { id: 'comment_deleted' }));
    comments.push(toDelete);
    try {
        for (const comment of comments) await f.store.create(comment);
        const stored = (await f.store.get(domain, toDelete.id))!;
        const intent = syncTombstone(f.project, toDelete);
        expect(intent.syncKey).toBe(syncPendingKey(domain, intent.id));
        expect(await f.store.deleteWithTombstone(domain, toDelete.id, stored.etag, intent)).toBe('ok');
        const first = await f.store.listSyncPending({ after: `${domain}:` });
        expect(first).toHaveLength(100);
        expect(first.every(doc => doc.domain === domain)).toBe(true);
        expect(first[0]!.id).toBe(intent.id);
        expect(first.find(doc => doc.id === legacy.id)?.syncKey).toBe(syncPendingKey(domain, legacy.id));
        const keys = first.map(doc => doc.syncKey!);
        expect(keys).toEqual([...keys].sort());
        const second = await f.store.listSyncPending({ after: keys.at(-1), limit: 23 });
        expect(second).toHaveLength(23);
        expect(second.every(doc => doc.syncKey! > keys.at(-1)!)).toBe(true);
        expect(new Set([...first, ...second].map(doc => doc.id)).size).toBe(123);
        expect(await f.store.listSyncPending({ after: `${domain}:`, limit: 5000 })).toHaveLength(1000);
        expect(await f.store.listSyncPending({ after: `${domain}:`, limit: Number.NaN })).toHaveLength(100);
        expect(await f.store.listSyncPending({ after: `${domain}:`, limit: 0 })).toHaveLength(1);
    } finally {
        for (const comment of comments) {
            const stored = await f.store.get(domain, comment.id);
            if (stored) await f.store.delete(domain, comment.id, stored.etag);
        }
        await f.store.deleteTombstone(domain, toDelete.id);
    }
});

test('Cosmos outbox queries bound the indexed cursor page before fetching resources', async () => {
    const f = await fixture(false);
    const comment = withSyncMark(f.project, null, source(f.project));
    const captured: { query: string; parameters: { name: string; value: unknown }[] }[] = [];
    const container = { items: { query: (input: { query: string; parameters: { name: string; value: unknown }[] }) => {
        captured.push(input);
        return { fetchAll: async () => ({ resources: [{ ...comment, _etag: 'do-not-export' }] }) };
    } } } as unknown as Container;
    const store = createCosmosCommentsStore(() => container);
    const after = syncPendingKey(comment.domain, 'comment_before');
    const page = await store.listSyncPending({ limit: 123, after });
    expect(page).toEqual([comment]);
    expect(captured[0]!.query).toContain('SELECT TOP @limit');
    expect(captured[0]!.query).toContain('IS_STRING(c.syncKey)');
    expect(captured[0]!.query).toContain('AND c.syncKey > @after ORDER BY c.syncKey ASC');
    expect(captured[0]!.parameters).toEqual([{ name: '@limit', value: 123 }, { name: '@after', value: after }]);
    await store.listSyncPending({ limit: 2000 });
    expect(captured[1]!.parameters).toEqual([{ name: '@limit', value: 1000 }]);
    expect(captured[1]!.query).not.toContain('@after');
    await store.listSyncPending();
    expect(captured[2]!.parameters).toEqual([{ name: '@limit', value: 100 }]);
});
