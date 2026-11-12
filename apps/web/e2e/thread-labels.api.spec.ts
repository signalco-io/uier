import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { parseQuery } from '@uier/comments-query';
import { type ThreadLabel, labelsForComment } from '../src/lib/app/threadLabel';
import { threadLabelsSchema } from '../src/lib/app/threadLabelSchema';
import { effectiveThreadLabels, loadThreadLabels } from '../src/lib/app/threadLabels';
import { setWorkspaceThreadLabels } from '../src/lib/app/workspaces';
import { updateProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { workspacePk, memberId, type DbProject, type DbWorkspace } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, setProjectCommentPrivate, setProjectCommentStatus } from '../src/lib/review/comments';
import { changeProjectCommentLabels } from '../src/lib/review/threadLabels';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { loadProjectComment } from '../src/lib/app/projectComments';
import type { AppContext } from '../src/lib/app/context';
import { allowedQueryFields, executeQuery, queryFacets, queryOptions } from '../src/lib/commentQuery/service';
import { toCommentQueryCandidate } from '../src/lib/repo/commentQuerySource';
import { persistProjectAccess } from './support/projectAccess';

const admin = { kind: 'member' as const, userId: 'admin', name: 'Admin', isAdmin: true };
const member = { kind: 'member' as const, userId: 'member', name: 'Member', isAdmin: false };
const guest = { kind: 'guest' as const, visitorId: 'visitor_labels', name: 'Reviewer' };
const labels: ThreadLabel[] = [
    { id: 'label_design', name: 'Design', color: 'violet', icon: 'paintbrush', description: 'Layout and visual feedback.' },
    { id: 'label_bug', name: 'Bug', color: 'red', icon: 'bug', description: 'A reproducible problem.' }
];
const previous = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous; });
async function fixture() {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12) } as DbProject, [admin, member, { userId: 'other', name: 'Other', isAdmin: false }]);
    const workspace: DbWorkspace = { type: 'workspace', id: project.workspaceId, pk: workspacePk(project.workspaceId), name: 'Labels', createdBy: 'admin', createdAt: new Date().toISOString(), aiTitles: false };
    await getAppStore().create(workspace);
    await setWorkspaceThreadLabels(workspace.id, admin.userId, labels);
    const create = () => createProjectComment(new Request('http://127.0.0.1'), project, member, { path: '/labels', origin: project.urls[0]!, position: { type: 'page' }, kind: 'feedback', text: 'Feedback about labels' });
    const comment = await create();
    const change = (ids: string[], mode: 'add' | 'remove' = 'add', key = randomUUID()) => changeProjectCommentLabels(project, member, comment.id, ids, mode, key);
    return { project, workspace, comment, create, change };
}

test('label definitions validate identities, distinct names, palette, icons, bounds and safe legacy defaults', () => {
    expect(threadLabelsSchema.parse([{ id: 'label_default', name: ' Default ' }])).toEqual([{ id: 'label_default', name: 'Default', color: 'ink', description: '' }]);
    expect(threadLabelsSchema.parse(labels)).toEqual(labels);
    for (const value of [
        [...labels, labels[0]], [...labels, { ...labels[0], id: 'label_other', name: 'design' }],
        ...[{ id: '../foreign' }, { name: '' }, { name: 'x'.repeat(41) }, { name: 'bad\u202e' }, { color: '#ffffff' }, { icon: '<svg>' }, { description: 'x'.repeat(501) }, { unknown: true }].map(patch => [{ ...labels[0], ...patch }]),
        Array.from({ length: 51 }, (_, i) => ({ ...labels[0], id: `label_${i}`, name: `${i}` }))
    ]) expect(threadLabelsSchema.safeParse(value).success).toBe(false);
    expect(effectiveThreadLabels(undefined, {})).toEqual([]);
    expect(effectiveThreadLabels({ threadLabels: labels }, { threadLabels: { mode: 'replace', value: [] } })).toEqual([]);
    expect(labelsForComment(labels, { labelIds: ['label_design', 'label_foreign', 'label_design'] })).toEqual([labels[0]]);
});

test('workspace admin defaults and validated project replacements resolve live, including empty overrides and clearing', async () => {
    const f = await fixture();
    await expect(setWorkspaceThreadLabels(f.workspace.id, member.userId, labels)).rejects.toThrow('Only admins');
    await expect(setWorkspaceThreadLabels(f.workspace.id, 'outsider', labels)).rejects.toThrow('Only admins');
    expect(await loadThreadLabels(f.project)).toEqual(labels);
    const own = (await updateProject(f.workspace.id, f.project.id, { threadLabels: { mode: 'replace', value: [] } }))!;
    await setWorkspaceThreadLabels(f.workspace.id, admin.userId, [labels[0]!]);
    expect(await loadThreadLabels(own)).toEqual([]);
    const inherited = (await updateProject(f.workspace.id, f.project.id, { threadLabels: undefined }))!;
    expect(await loadThreadLabels(inherited)).toEqual([labels[0]]);
    await expect(updateProject(f.workspace.id, f.project.id, { threadLabels: { mode: 'replace', value: [{ ...labels[0]!, color: 'bad' as 'ink' }] } })).rejects.toThrow();
    expect((await getAppStore().get<DbWorkspace>(f.workspace.pk, f.workspace.id))!.doc.aiTitles).toBe(false);
});

test('atomic concurrent adds, receipt replay after removal, key conflicts and no-ops preserve independent edits', async () => {
    const f = await fixture();
    const key = randomUUID();
    await Promise.all([f.change(['label_design'], 'add', key), f.change(['label_bug'])]);
    const combined = (await getCommentsStore().get(f.comment.domain, f.comment.id))!.comment;
    expect(combined.labelIds?.sort()).toEqual(['label_bug', 'label_design']);
    expect(combined.history?.filter(entry => entry.action === 'labels')).toHaveLength(2);
    expect(combined.resolved).toBe(f.comment.resolved);
    expect(combined.thread).toEqual(f.comment.thread);
    await f.change(['label_design'], 'remove');
    await f.change(['label_design'], 'add', key);
    expect((await getCommentsStore().get(f.comment.domain, f.comment.id))!.comment.labelIds).toEqual(['label_bug']);
    await expect(f.change(['label_bug'], 'add', key)).rejects.toMatchObject({ code: 'conflict' });
    const before = await getCommentsStore().get(f.comment.domain, f.comment.id);
    await f.change(['label_bug']);
    expect((await getCommentsStore().get(f.comment.domain, f.comment.id))!.comment).toEqual(before!.comment);
});

test('current membership, private visibility, guest and foreign labels are checked on writes and receipt replay', async () => {
    const f = await fixture();
    await expect(f.change(['label_foreign'])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.change(['label_bug', 'label_bug'])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(changeProjectCommentLabels(f.project, guest, f.comment.id, ['label_bug'], 'add', randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
    await setProjectCommentPrivate(f.project, admin, f.comment.id, true);
    const key = randomUUID();
    await f.change(['label_bug'], 'add', key);
    const other = { ...member, userId: 'other' };
    await expect(changeProjectCommentLabels(f.project, other, f.comment.id, ['label_bug'], 'add', randomUUID())).rejects.toThrow();
    await getAppStore().delete(f.project.pk, memberId(member.userId));
    await expect(f.change(['label_bug'], 'add', key)).rejects.toThrow();
});

test('fresh project settings reject obsolete labels; removed definitions hide in app and packets without guest exposure', async () => {
    const f = await fixture();
    await f.change(['label_design']);
    const context = { user: { id: member.userId }, workspace: { ...f.workspace, threadLabels: labels }, isAdmin: false } as AppContext;
    expect((await loadProjectComment(context, f.project, f.comment.id))!.labels).toEqual([labels[0]]);
    expect(await projectFeedbackExport(f.project, member, f.comment.id, undefined, 'http://127.0.0.1')).toMatchObject({ labels: [labels[0]] });
    expect(await projectFeedbackExport(f.project, guest, f.comment.id, f.project.urls[0], 'http://127.0.0.1')).not.toHaveProperty('labels');
    await updateProject(f.workspace.id, f.project.id, { threadLabels: { mode: 'replace', value: [labels[1]!] } });
    await expect(f.change(['label_design'])).rejects.toMatchObject({ code: 'invalid_request' });
    const current = (await updateProject(f.workspace.id, f.project.id, { threadLabels: { mode: 'replace', value: [labels[1]!] } }))!;
    expect((await loadProjectComment(context, current, f.comment.id))!.labels).toEqual([]);
    expect(await projectFeedbackExport(current, member, f.comment.id, undefined, 'http://127.0.0.1')).toMatchObject({ labels: [] });
    expect((await f.change(['label_bug'])).labelIds).toEqual(['label_bug']);
});

test('label query sets run before paging and exact facets; options name authorized labels, guests cannot query them', async () => {
    const f = await fixture();
    const second = await f.create();
    await f.change(['label_bug']);
    await changeProjectCommentLabels(f.project, member, second.id, ['label_bug', 'label_design'], 'add', randomUUID());
    await setProjectCommentStatus(f.project, member, second.id, 'done');
    const context = { sources: [{ domain: f.comment.domain, project: f.project, actor: member }], scope: { kind: 'project' as const, projectId: f.project.id } };
    const query = parseQuery({ version: 1, scope: context.scope, collection: 'ordinary', where: { field: 'labels', operator: 'includesAny', value: ['label_bug'] }, order: [{ field: 'number', direction: 'desc' }], timezone: 'UTC' });
    const first = await executeQuery(query, context, { size: 1 });
    expect(first.total).toBe(2);
    expect(first.items.map(item => item.id)).toEqual([second.id]);
    expect((await executeQuery(query, context, { size: 1, cursor: first.nextCursor! })).items.map(item => item.id)).toEqual([f.comment.id]);
    expect((await queryFacets(query, context, ['labels'])).facets.labels).toEqual(expect.arrayContaining([{ value: 'label_bug', count: 2 }, { value: 'label_design', count: 1 }]));
    expect((await queryOptions(query, context, 'labels')).options).toEqual(expect.arrayContaining([{ value: 'label_bug', count: 2, label: 'Bug' }]));
    expect(toCommentQueryCandidate((await getCommentsStore().get(f.comment.domain, second.id))!.comment, 'revision').labelIds).toEqual(['label_bug', 'label_design']);
    expect(allowedQueryFields([{ ...context.sources[0]!, actor: guest }])).not.toContain('labels');
    await expect(executeQuery(query, { ...context, sources: [{ ...context.sources[0]!, actor: guest }] })).rejects.toMatchObject({ code: 'forbidden' });
});


test('thread label limits are checked against the atomic result and removed definitions free slots', async () => {
    const f = await fixture();
    const catalog: ThreadLabel[] = Array.from({ length: 21 }, (_, i) => ({ id: `label_${i}`, name: `Label ${i}`, color: 'ink', description: '' }));
    await setWorkspaceThreadLabels(f.workspace.id, admin.userId, catalog);
    await f.change(catalog.slice(0, 20).map(label => label.id));
    await expect(f.change([catalog[20]!.id])).rejects.toMatchObject({ code: 'invalid_request' });
    await setWorkspaceThreadLabels(f.workspace.id, admin.userId, catalog.slice(1));
    expect((await f.change([catalog[20]!.id])).labelIds).toHaveLength(20);
});
