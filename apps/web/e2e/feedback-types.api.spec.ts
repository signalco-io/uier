import { mcpEventData, mcpEventList } from '../src/lib/mcp/events/catalog';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { defaultFeedbackTypes, feedbackTypeSnapshot, type FeedbackType } from '@uier/toolbar/feedback-types';
import { effectiveFeedbackTypes, feedbackTypeForSubmission, loadFeedbackTypes } from '../src/lib/app/feedbackTypes';
import { feedbackTypesSchema, projectFeedbackTypesSchema } from '../src/lib/app/feedbackTypeSchema';
import { workspacePk, type DbProject, type DbWorkspace } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { updateProject } from '../src/lib/app/projects';
import { getWorkspace, setWorkspaceFeedbackTypes } from '../src/lib/app/workspaces';
import { createCommentSchema } from '../src/lib/comments/validation';
import { createProjectComment, replyToProjectComment } from '../src/lib/review/comments';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { reviewProjectDto } from '../src/lib/review/routes';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { loadProjectComments } from '../src/lib/app/projectComments';
import type { AppContext } from '../src/lib/app/context';
import { persistProjectAccess } from './support/projectAccess';

const custom: FeedbackType = { id: 'custom_feature_request', label: 'Feature request', icon: 'rocket', placeholder: 'What would help your work?', enabled: true };
const types = () => [...defaultFeedbackTypes.map(type => ({ ...type })), { ...custom }];
const admin = { kind: 'member' as const, userId: 'admin', name: 'Admin', isAdmin: true };
const previous = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous; });
async function fixture() {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12) } as DbProject);
    const workspace: DbWorkspace = { type: 'workspace', id: project.workspaceId, pk: workspacePk(project.workspaceId), name: 'Types', createdBy: 'admin', createdAt: new Date().toISOString(), aiTitles: false };
    await getAppStore().create(workspace);
    return { project, workspace };
}

test('workspace defaults and project replacements resolve independently, including all types disabled', () => {
    expect(effectiveFeedbackTypes(null, {})).toEqual(defaultFeedbackTypes);
    const workspace = { feedbackTypes: types() };
    expect(effectiveFeedbackTypes(workspace, {})).toEqual(types());
    const own = { feedbackTypes: { mode: 'replace' as const, value: types().map(type => ({ ...type, enabled: false })) } };
    workspace.feedbackTypes[2]!.label = 'Changed workspace name';
    expect(effectiveFeedbackTypes(workspace, own).filter(type => type.enabled)).toEqual([]);
    expect(effectiveFeedbackTypes(workspace, own)[2]!.label).toBe('Feature request');
    expect(effectiveFeedbackTypes(workspace, {})[2]!.label).toBe('Changed workspace name');
});

test('settings reject invalid IDs, icons, duplicate names/IDs, control characters and oversized values', () => {
    expect(feedbackTypesSchema.parse(types())).toEqual(types());
    for (const patch of [ { id: 'rewrite' }, { id: 'comment' }, { id: 'custom_x' }, { icon: 'https://bad.example/x.svg' }, { label: '' }, { label: 'x'.repeat(41) }, { label: 'Name\u202e' }, { placeholder: '' }, { placeholder: 'x'.repeat(301) }, { enabled: 'yes' }, { arbitrary: 'data' } ]) {
        expect(feedbackTypesSchema.safeParse([...defaultFeedbackTypes, { ...custom, ...patch }]).success).toBe(false);
    }
    for (const invalid of [[...types(), custom], [...types(), { ...custom, id: 'custom_another_feature', label: 'feedback' }], [custom], Array.from({ length: 13 }, () => custom)])
        expect(feedbackTypesSchema.safeParse(invalid).success).toBe(false);
    expect(projectFeedbackTypesSchema.safeParse({ mode: 'append', value: types() }).success).toBe(false);
    expect(feedbackTypeSnapshot({ ...custom, secret: 'private', placeholder: 'not exported' }, custom.id)).toEqual({ id: custom.id, label: custom.label, icon: custom.icon });
    expect(feedbackTypeSnapshot(custom, 'bug')).toBeUndefined();
});

test('services enforce admin authority and validate before writes, preserving unrelated settings', async () => {
    const { project, workspace } = await fixture();
    for (const user of ['member', 'outsider']) await expect(setWorkspaceFeedbackTypes(workspace.id, user, types())).rejects.toThrow('Only admins');
    await expect(setWorkspaceFeedbackTypes(workspace.id, 'admin', [{ ...custom, enabled: 'true' }])).rejects.toThrow();
    expect((await getWorkspace(workspace.id))!.feedbackTypes).toBeUndefined();
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types());
    expect(await loadFeedbackTypes(project)).toEqual(types());
    expect((await getWorkspace(workspace.id))!.aiTitles).toBe(false);
    await expect(updateProject(workspace.id, project.id, { feedbackTypes: { mode: 'replace', value: [{ ...custom, icon: 'bad' as never }] } })).rejects.toThrow();
    const own = types().map(type => ({ ...type, enabled: type.id === custom.id }));
    const updated = (await updateProject(workspace.id, project.id, { feedbackTypes: { mode: 'replace', value: own } }))!;
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types().map(type => ({ ...type, enabled: false })));
    expect(await loadFeedbackTypes(updated)).toEqual(own);
    const inherited = (await updateProject(workspace.id, project.id, { feedbackTypes: undefined }))!;
    expect((await loadFeedbackTypes(inherited)).every(type => !type.enabled)).toBe(true);
});

test('submissions enforce current enabled project types and page positions, never client display metadata', async () => {
    const { project, workspace } = await fixture();
    const input = { origin: project.urls[0]!, path: '/types', kind: custom.id, position: { type: 'page' as const }, text: 'Add this feature' };
    const request = new Request('http://127.0.0.1/types');
    await expect(createProjectComment(request, project, admin, input)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(feedbackTypeForSubmission(undefined, custom.id)).rejects.toMatchObject({ code: 'invalid_request' });
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types());
    const forged = await createCommentSchema.parseAsync({ ...input, feedbackType: { ...custom, label: 'FORGED' } });
    expect(forged).not.toHaveProperty('feedbackType');
    expect((await createCommentSchema.safeParseAsync({ ...input, position: { type: 'point', selector: 'h1', xNormal: .5, yNormal: .5 } })).success).toBe(false);
    const saved = await createProjectComment(request, project, admin, { ...input, ...forged });
    expect(saved.feedbackType).toEqual({ id: custom.id, label: custom.label, icon: 'rocket' });
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types().map(type => ({ ...type, enabled: false })));
    for (const kind of ['feedback', 'bug', custom.id] as const)
        await expect(createProjectComment(request, project, admin, { ...input, kind })).rejects.toMatchObject({ code: 'invalid_request' });
    // Replies do not revalidate an old thread against the new settings.
    const replied = await replyToProjectComment(request, project, admin, saved.id, { text: 'Still discussing this type' });
    expect(replied.kind).toBe(custom.id);
    expect(replied.feedbackType).toEqual(saved.feedbackType);
});

test('saved custom kinds survive disabled/renamed settings in toolbar DTOs, the app and feedback packets; retries keep the original type', async () => {
    const { project, workspace } = await fixture();
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types());
    const input = { origin: project.urls[0]!, path: '/types', kind: custom.id, position: { type: 'page' as const }, text: 'Feature discussion', idempotencyKey: randomUUID() };
    const request = new Request('http://127.0.0.1/types');
    const comment = await createProjectComment(request, project, admin, input);
    await setWorkspaceFeedbackTypes(workspace.id, 'admin', types().map(type => type.id === custom.id ? { ...type, label: 'New name', icon: 'bookmark', enabled: false } : type));
    expect((await createProjectComment(request, project, admin, input)).id).toBe(comment.id);
    const dto = toReviewCommentDto(comment, admin, new Map(), project.urls);
    expect(dto).toMatchObject({ kind: custom.id, feedbackType: comment.feedbackType });
    const packet = await projectFeedbackExport(project, admin, comment.id, undefined, 'https://uier.example');
    expect(packet.context).toMatchObject({ kind: custom.id, feedbackType: comment.feedbackType });
    expect(packet.markdown).toContain('Feature request');
    expect(packet.markdown).toContain('rocket');
    expect(packet.markdown).not.toContain(custom.placeholder);
    expect(mcpEventData('feedback.created', project, comment, comment.notificationEvents![0]!, new Map([['admin', 'Admin']]), undefined)).toMatchObject({ kind: custom.id, feedbackType: comment.feedbackType });
    expect(() => JSON.stringify(mcpEventList())).not.toThrow();
    const context = { user: { id: 'admin', name: 'Admin' }, member: { role: 'admin', projects: 'all' }, isAdmin: true, workspace } as unknown as AppContext;
    const app = await loadProjectComments(context, project);
    expect(app.find(item => item.id === comment.id)).toMatchObject({ kind: custom.id, feedbackType: comment.feedbackType });
});

test('review info offers only enabled feedback types; a disabled type stays with the admins', async () => {
    const { project } = await fixture();
    const disabled = types().map(type => type.id === custom.id ? { ...type, enabled: false } : type);
    const dto = reviewProjectDto({ ...project, publicId: project.id }, true, disabled);
    expect(dto.feedbackTypes?.map(type => type.id)).not.toContain(custom.id);
    expect(dto.feedbackTypes?.length).toBeGreaterThan(0);
    expect(dto.feedbackTypes?.every(type => type.enabled)).toBe(true);
    expect(JSON.stringify(dto)).not.toContain(custom.placeholder);
});
