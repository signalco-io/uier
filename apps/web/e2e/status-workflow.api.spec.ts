import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { defaultStatusWorkflow, statusForComment, type StatusWorkflow } from '../src/lib/app/statusWorkflow';
import { statusWorkflowSchema } from '../src/lib/app/statusWorkflowSchema';
import { effectiveStatusWorkflow, loadStatusWorkflow } from '../src/lib/app/statusWorkflows';
import { setWorkspaceStatusWorkflow } from '../src/lib/app/workspaces';
import { updateProject } from '../src/lib/app/projects';
import { workspacePk, type DbProject, type DbWorkspace } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, setProjectCommentWorkflowStatus, setProjectCommentStatus, setProjectCommentResolved, setProjectCommentArchived } from '../src/lib/review/comments';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { feedbackStage } from '@uier/toolbar/verification';
import { persistProjectAccess } from './support/projectAccess';

const admin = { kind: 'member' as const, userId: 'admin', name: 'Admin', isAdmin: true };
const member = { kind: 'member' as const, userId: 'member', name: 'Member', isAdmin: false };
const workflow = (): StatusWorkflow => ({ ...structuredClone(defaultStatusWorkflow), initialStatusId: 'custom_approved', doneStatusId: 'custom_production', archiveStatusId: 'custom_rejected', statuses: [
    ...structuredClone(defaultStatusWorkflow.statuses),
    { id: 'custom_approved', category: 'open', label: 'Approved', description: 'Approved for implementation.' },
    { id: 'custom_merging', category: 'in-progress', label: 'Merging', description: 'Review and merge the pull request.' },
    { id: 'custom_qa', category: 'ready', label: 'QA', description: 'The requested reviewer checks the fix.' },
    { id: 'custom_production', category: 'done', label: 'Production', description: 'Released to production.' },
    { id: 'custom_rejected', category: 'archive', label: 'Rejected', description: 'Declined feedback.' }
] });
const previous = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous; });
async function fixture() {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12) } as DbProject);
    const workspace: DbWorkspace = { type: 'workspace', id: project.workspaceId, pk: workspacePk(project.workspaceId), name: 'Workflow', createdBy: 'admin', createdAt: new Date().toISOString(), aiTitles: false };
    await getAppStore().create(workspace);
    const create = (idempotencyKey?: string) => createProjectComment(new Request('http://127.0.0.1'), project, member, { path: '/workflow', origin: project.urls[0]!, position: { type: 'page' }, kind: 'feedback', text: 'Workflow feedback', idempotencyKey });
    return { project, workspace, create };
}

test('configuration validates categories, IDs, names, bounded text and category-specific defaults', () => {
    const value = workflow();
    expect(statusWorkflowSchema.parse(value)).toEqual(value);
    for (const invalid of [
        { ...value, initialStatusId: 'custom_qa' }, { ...value, doneStatusId: 'custom_approved' }, { ...value, archiveStatusId: 'done' },
        { ...value, statuses: value.statuses.filter(status => status.category !== 'ready') },
        { ...value, statuses: [...value.statuses, value.statuses[0]] },
        ...[{ label: 'Open' }, { label: 'x'.repeat(41) }, { description: 'x'.repeat(501) }, { label: 'a\u202e' }, { id: '../bad' }, { category: 'unknown' }].map(patch => ({ ...value, statuses: [...value.statuses.slice(0, -1), { ...value.statuses.at(-1), ...patch }] }))
    ]) expect(statusWorkflowSchema.safeParse(invalid).success).toBe(false);
    expect(effectiveStatusWorkflow({ statusWorkflow: { ...value, statuses: [] } }, {})).toEqual(defaultStatusWorkflow);
});

test('admins save live workspace defaults; independent project overrides and clearing overrides preserve other settings', async () => {
    const f = await fixture();
    await expect(setWorkspaceStatusWorkflow(f.workspace.id, member.userId, workflow())).rejects.toThrow('Only admins');
    await expect(setWorkspaceStatusWorkflow(f.workspace.id, 'outsider', workflow())).rejects.toThrow('Only admins');
    await expect(setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, { ...workflow(), doneStatusId: 'open' })).rejects.toThrow();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, workflow());
    expect(await loadStatusWorkflow(f.project)).toEqual(workflow());
    const own = (await updateProject(f.workspace.id, f.project.id, { statusWorkflow: { mode: 'replace', value: defaultStatusWorkflow } }))!;
    expect(await loadStatusWorkflow(own)).toEqual(defaultStatusWorkflow);
    const inherited = (await updateProject(f.workspace.id, f.project.id, { statusWorkflow: undefined }))!;
    expect(await loadStatusWorkflow(inherited)).toEqual(workflow());
    expect((await getAppStore().get<DbWorkspace>(f.workspace.pk, f.workspace.id))!.doc.aiTitles).toBe(false);
});

test('creation defaults and receipt retries use the saved workflow, while category filters retain their meaning', async () => {
    const f = await fixture();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, workflow());
    const key = randomUUID();
    const comment = await f.create(key);
    expect(comment.workflowStatusId).toBe('custom_approved');
    expect(feedbackStage(comment)).toBe('open');
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, { ...workflow(), initialStatusId: 'custom_merging' });
    expect((await f.create(key)).id).toBe(comment.id);
    expect((await f.create()).inProgress).toBe(true);
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, { ...workflow(), initialStatusId: 'custom_production' });
    expect(feedbackStage(await f.create())).toBe('done');
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, { ...workflow(), initialStatusId: 'custom_rejected' });
    expect(await f.create()).toMatchObject({ archiveStatusId: 'custom_rejected', archivedAt: expect.any(String), resolved: false });
});

test('custom moves are atomic, preserve same-category completion time, enforce authority and reject removed/foreign IDs', async () => {
    const f = await fixture();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, workflow());
    const comment = await f.create();
    const set = (id: string) => setProjectCommentWorkflowStatus(f.project, member, comment.id, id);
    expect(await set('custom_merging')).toMatchObject({ inProgress: true, workflowStatusId: 'custom_merging' });
    await expect(set('foreign_status')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(set('custom_qa')).rejects.toMatchObject({ code: 'invalid_request' });
    const done = await set('done');
    const production = await set('custom_production');
    expect(production.completedAt).toBe(done.completedAt);
    expect(production.resolved).toBe(true);
    await expect(setProjectCommentWorkflowStatus(f.project, { kind: 'anonymous' }, comment.id, 'open')).rejects.toThrow();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, defaultStatusWorkflow);
    await expect(set('custom_merging')).rejects.toMatchObject({ code: 'invalid_request' });
    const saved = (await getCommentsStore().get(comment.domain, comment.id))!.comment;
    expect(statusForComment(defaultStatusWorkflow, saved).id).toBe('done');
});

test('Done and Archive category APIs route to defaults; archive and restore retain the ordinary custom status', async () => {
    const f = await fixture();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, workflow());
    const comment = await f.create();
    await setProjectCommentWorkflowStatus(f.project, member, comment.id, 'custom_merging');
    const archived = await setProjectCommentArchived(f.project, member, comment.id, true, randomUUID());
    expect(archived).toMatchObject({ archiveStatusId: 'custom_rejected', workflowStatusId: 'custom_merging', inProgress: true });
    expect(statusForComment(workflow(), archived).category).toBe('archive');
    const restored = await setProjectCommentArchived(f.project, member, comment.id, false, randomUUID());
    expect(statusForComment(workflow(), restored).id).toBe('custom_merging');
    expect((await setProjectCommentStatus(f.project, member, comment.id, 'done')).workflowStatusId).toBe('custom_production');
    await setProjectCommentResolved(f.project, member, comment.id, false);
    expect((await setProjectCommentResolved(f.project, member, comment.id, true)).workflowStatusId).toBe('custom_production');
});

test('Ready statuses require a real verification request; same-category moves retain the check and confirmation uses the configured Done status', async () => {
    const f = await fixture();
    await setWorkspaceStatusWorkflow(f.workspace.id, admin.userId, workflow());
    const comment = await f.create();
    const ask = () => changeFixVerification(f.project, admin, comment.id, { action: 'request', reviewerId: 'author', statusId: 'custom_qa', expectedRevision: null, idempotencyKey: randomUUID() });
    const ready = await ask();
    expect(statusForComment(workflow(), ready).id).toBe('custom_qa');
    const other = await setProjectCommentWorkflowStatus(f.project, member, comment.id, 'ready');
    expect(other.verification).toEqual(ready.verification);
    await expect(setProjectCommentWorkflowStatus(f.project, member, comment.id, 'custom_merging')).rejects.toMatchObject({ code: 'invalid_request' });
    const confirmed = await changeFixVerification(f.project, member, comment.id, { action: 'confirm', expectedRevision: ready.verification!.revision, idempotencyKey: randomUUID() });
    expect(confirmed).toMatchObject({ resolved: true, workflowStatusId: 'custom_production', verification: { outcome: 'confirmed' } });
});
