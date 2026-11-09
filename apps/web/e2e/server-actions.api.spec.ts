import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { parseActionInput, userIdSchema } from '../src/lib/app/validation';
import { UserFacingError } from '../src/lib/app/actionErrors';
import { assignCommentActionSchema, commentActionSchema, deleteReplyActionSchema, editCommentActionSchema,
    filterAuthorActionSchema, notificationActionSchema, privateCommentActionSchema, readCommentActionSchema,
    readCommentsActionSchema, replyCommentActionSchema, statusCommentActionSchema } from '../src/components/app/comments/actionSchemas';
import { removeMemberActionSchema, revokeInvitationActionSchema } from '../src/components/app/users/actionSchemas';
import { deleteProjectActionSchema, projectEmailsActionSchema, projectStatusActionSchema } from '../src/components/app/projects/actionSchemas';
import { switchWorkspaceActionSchema } from '../src/components/app/shell/actionSchemas';
import { revokeCredentialActionSchema } from '../src/lib/mcp/actionSchemas';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import type { DbProject } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { setProjectCommentPrivate, setProjectCommentResolved } from '../src/lib/review/comments';
import { followThread, setProjectMuted } from '../src/lib/notifications/preferences';

test('positional action schemas validate every argument before it is used', () => {
    const thread = { projectId: 'abc123def456', commentId: 'comment_valid' };
    const cases: [z.ZodType, Record<string, unknown>][] = [
        [commentActionSchema, thread], [statusCommentActionSchema, { ...thread, status: 'in-progress' }],
        [privateCommentActionSchema, { ...thread, isPrivate: true }],
        [assignCommentActionSchema, { ...thread, assigneeId: 'u_alex' }],
        [editCommentActionSchema, { ...thread, text: 'Valid feedback' }],
        [replyCommentActionSchema, { ...thread, text: 'Reply', mentions: [{ userId: 'u_alex', start: 0, end: 5 }], idempotencyKey: '0123456789abcdef' }],
        [deleteReplyActionSchema, { ...thread, itemId: 'item_valid' }],
        [filterAuthorActionSchema, { ...thread, itemId: 'item_valid' }],
        [readCommentActionSchema, { ...thread, sequence: 1 }],
        [readCommentsActionSchema, { projectId: thread.projectId, threads: [{ id: thread.commentId, sequence: 1 }] }],
        [notificationActionSchema, { projectId: thread.projectId, threadId: thread.commentId, enabled: false }],
        [removeMemberActionSchema, { userId: 'u_alex' }],
        [revokeInvitationActionSchema, { invitationId: 'invitation_valid' }],
        [projectStatusActionSchema, { projectId: thread.projectId, status: 'done' }],
        [deleteProjectActionSchema, { projectId: thread.projectId, confirmation: 'Project name' }],
        [projectEmailsActionSchema, { projectId: thread.projectId, muted: true }],
        [switchWorkspaceActionSchema, { workspaceId: 'w_u_alex_2' }],
        [revokeCredentialActionSchema, { id: 'a'.repeat(64) }]
    ];
    for (const [schema, valid] of cases) {
        expect(parseActionInput(schema, valid)).toEqual(valid);
        for (const field of Object.keys(valid)) {
            for (const value of [{}, []]) {
                const input = { ...valid, [field]: field === 'mentions' && Array.isArray(value) ? [{ userId: 'bad', start: 0, end: 1 }] : value };
                expect(() => parseActionInput(schema, input), `${field}: ${JSON.stringify(value)}`).toThrow(UserFacingError);
                expect(() => parseActionInput(schema, input)).toThrow('Check the request and try again.');
            }
        }
    }
    expect(parseActionInput(assignCommentActionSchema, { ...thread, assigneeId: null }).assigneeId).toBeNull();
    expect(parseActionInput(notificationActionSchema, { projectId: thread.projectId, enabled: true }).threadId).toBeUndefined();
    expect(parseActionInput(filterAuthorActionSchema, thread).itemId).toBeUndefined();
    for (const value of ['false', 'true', 0, 1, null, undefined]) {
        expect(statusCommentActionSchema.safeParse({ ...thread, status: value }).success).toBe(false);
        expect(privateCommentActionSchema.safeParse({ ...thread, isPrivate: value }).success).toBe(false);
        expect(notificationActionSchema.safeParse({ projectId: thread.projectId, enabled: value }).success).toBe(false);
        expect(projectEmailsActionSchema.safeParse({ projectId: thread.projectId, muted: value }).success).toBe(false);
    }
    // Ready to verify is a fix check request, never a plain status write
    for (const status of ['ready', 'resolved', 'In progress', 'in_progress'])
        expect(statusCommentActionSchema.safeParse({ ...thread, status }).success).toBe(false);
    for (const status of ['open', 'in-progress', 'done'])
        expect(statusCommentActionSchema.safeParse({ ...thread, status }).success).toBe(true);
    for (const value of ['', 'bad/id#', null, 123]) {
        expect(commentActionSchema.safeParse({ ...thread, commentId: value }).success).toBe(false);
        expect(notificationActionSchema.safeParse({ projectId: thread.projectId, threadId: value, enabled: true }).success).toBe(false);
    }
    for (const value of ['', 'u_', 'u_bad/id', 'u_bad#id', 'u_bad?id', 'u_' + 'a'.repeat(65), new String('u_alex')])
        expect(userIdSchema.safeParse(value).success).toBe(false);
    expect(userIdSchema.safeParse('u_' + 'a'.repeat(64)).success).toBe(true);
    for (const idempotencyKey of ['', 'short', 'a'.repeat(129), undefined])
        expect(replyCommentActionSchema.safeParse({ ...thread, text: 'Reply', idempotencyKey }).success).toBe(false);
    for (const text of ['', ' ', 'a'.repeat(1001)])
        expect(replyCommentActionSchema.safeParse({ ...thread, text, idempotencyKey: '0123456789abcdef' }).success).toBe(false);
    for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity])
        expect(readCommentActionSchema.safeParse({ ...thread, sequence }).success).toBe(false);
});

test('services reject non-booleans without storing comments, notification preferences or subscriptions', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = { id: randomUUID() } as DbProject;
        const actor = { kind: 'member', userId: 'u_alex', name: 'Alex', isAdmin: true } as const;
        const comment: DbComment = { id: 'comment_boolean', domain: `project:${project.id}`, path: '/', private: false, resolved: false,
            authorId: 'user:u_alex', position: { type: 'page' }, thread: { items: [{ id: 'item_first', text: 'Feedback' }] } };
        const comments = getMemoryCommentsStore();
        await comments.create(comment);
        const before = await comments.get(comment.domain, comment.id);
        for (const invalid of ['false', 'true', 0, 1, null, undefined, {}, []]) {
            await expect(setProjectCommentResolved(project, actor, comment.id, invalid as boolean)).rejects.toBeInstanceOf(z.ZodError);
            await expect(setProjectCommentPrivate(project, actor, comment.id, invalid as boolean)).rejects.toBeInstanceOf(z.ZodError);
            await expect(setProjectMuted(project, actor, invalid as boolean)).rejects.toBeInstanceOf(z.ZodError);
            await expect(followThread(project, actor, comment.id, invalid as boolean)).rejects.toBeInstanceOf(z.ZodError);
        }
        expect(await comments.get(comment.domain, comment.id)).toEqual(before);
        expect(await getAppStore().query({ type: 'notification-preference', pk: `notifications:${project.id}` })).toEqual([]);
        expect(await getAppStore().query({ type: 'notification-subscription', pk: `notifications:${project.id}` })).toEqual([]);
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});


test('app reply and participant actions validate requests and reject an expired app session', async ({ request, baseURL }) => {
    const manifest = JSON.parse(readFileSync(new URL('../.next/server/server-reference-manifest.json', import.meta.url), 'utf8')) as {
        node: Record<string, { exportedName?: string }>;
    };
    const call = async (name: string, args: unknown[]) => {
        const action = Object.entries(manifest.node).find(([, entry]) => entry.exportedName === name)?.[0];
        expect(action).toBeTruthy();
        const response = await request.post('/app/projects/abc123def456', {
            headers: { 'Next-Action': action!, 'Content-Type': 'text/plain;charset=UTF-8', Origin: baseURL!, Cookie: 'uier_session=invalid' },
            data: JSON.stringify(args), maxRedirects: 0
        });
        return response.text();
    };
    const input = { projectId: 'abc123def456', commentId: 'comment_valid', text: 'Reply', idempotencyKey: '0123456789abcdef' };
    expect(await call('replyCommentAction', [input])).toContain('Your session has ended. Sign in again.');
    expect(await call('replyCommentAction', [{ ...input, text: ' ' }])).toContain('Check the request and try again.');
    expect(await call('replyCommentAction', [{ ...input, idempotencyKey: 'short' }])).toContain('Check the request and try again.');
    expect(await call('replyCommentAction', [{ ...input, mentions: [{ userId: 'bad/id', start: 0, end: 5 }] }])).toContain('Check the request and try again.');
    expect(await call('commentParticipantsAction', [input.projectId, input.commentId])).toContain('Your session has ended. Sign in again.');
    expect(await call('commentParticipantsAction', [input.projectId, {}])).toContain('Check the request and try again.');
});

test('Review action checks authority before parsing malformed feedback types', async ({ request, baseURL }) => {
    const manifest = JSON.parse(readFileSync(new URL('../.next/server/server-reference-manifest.json', import.meta.url), 'utf8')) as { node: Record<string, { exportedName?: string }> };
    const action = Object.entries(manifest.node).find(([, entry]) => (entry as { exportedName?: string }).exportedName === 'updateProjectReviewAction')?.[0];
    expect(action).toBeTruthy();
    for (const feedbackTypes of ['{invalid', JSON.stringify({ mode: 'replace', value: [] })]) {
        const response = await request.post('/app/projects/abc123def456/settings/review', {
            headers: { 'Next-Action': action!, Origin: baseURL!, Cookie: 'uier_session=invalid' },
            multipart: { '0': '[null,"$K1"]', '1_projectId': 'abc123def456', '1_feedbackTypes': feedbackTypes },
            maxRedirects: 0
        });
        expect(await response.text()).toContain('Your session has ended. Sign in again.');
    }
});
