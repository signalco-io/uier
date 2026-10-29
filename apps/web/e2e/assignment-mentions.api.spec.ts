import { persistProjectAccess } from './support/projectAccess';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { updateUserName } from '../src/lib/app/users';
import { getAppStore } from '../src/lib/app/store';
import { memberId, workspacePk, type DbMember, type DbProject, type DbUser } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { eligibleParticipants, mentionsSchema } from '../src/lib/review/participants';
import { getProjectComment, setProjectCommentAssignee, setProjectCommentPrivate, editProjectCommentText, editProjectCommentItem, replyToProjectComment } from '../src/lib/review/comments';
import { participantNames, toReviewCommentDto } from '../src/lib/review/dto';
import { moveMentions } from '@uier/toolbar/mentions';
import type { DbComment } from '../src/lib/db/schema';
import { assignReviewComment } from '../src/lib/review/routes';
import { errorResponse } from '../src/lib/comments/http';

test('assignment and stable mention identities enforce project membership and private visibility at the service boundary', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const key = randomUUID();
        const project = { id: `project-${key}`, workspaceId: `workspace-${key}` } as DbProject;
        const app = getAppStore();
        const ids = ['owner', 'sameNameA', 'sameNameB', 'otherProject'].map(label => `u_${label}_${key.replaceAll('-', '')}`);
        for (const [index, id] of ids.entries()) {
            await app.create<DbUser>({ type: 'user', id, pk: `user:${id}`, email: `${index}@example.com`, name: index === 0 ? 'Owner' : 'Alex', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            await app.create<DbMember>({ type: 'member', id: memberId(id), pk: workspacePk(project.workspaceId), userId: id, workspaceId: project.workspaceId, email: `${index}@example.com`, role: index === 0 ? 'admin' : 'commenter', projects: index === 3 ? ['another-project'] : 'all', createdAt: new Date().toISOString() });
        }
        await persistProjectAccess(project, []);
        const owner = { kind: 'member', userId: ids[0]!, name: 'Owner', isAdmin: true } as const;
        const member = { kind: 'member', userId: ids[1]!, name: 'Alex', isAdmin: false } as const;
        const guest = { kind: 'guest', visitorId: 'guest-author' } as const;
        const store = getMemoryCommentsStore();
        const comment: DbComment = { id: `comment_${key}`, domain: `project:${project.id}`, path: '/', position: { type: 'page' }, authorId: `user:${ids[0]}`, thread: { items: [{ id: 'first', text: 'Original', authorId: `user:${ids[0]}` }] } };
        await store.create(comment);
        expect(await eligibleParticipants(project, member)).toHaveLength(3);
        expect((await eligibleParticipants(project, owner)).filter(p => p.name === 'Alex').map(p => p.id)).toEqual(expect.arrayContaining(ids.slice(1, 3)));
        await expect(eligibleParticipants(project, guest)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(setProjectCommentAssignee(project, guest, comment.id, ids[1]!)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(setProjectCommentAssignee(project, owner, comment.id, ids[3]!)).rejects.toMatchObject({ code: 'forbidden' });
        let saved = await setProjectCommentAssignee(project, member, comment.id, ids[2]!);
        expect(saved.assigneeId).toBe(ids[2]);
        const mention = { userId: ids[2]!, start: 0, end: 5 };
        saved = await editProjectCommentItem(project, owner, comment.id, 'first', { text: '@Alex please check', expectedText: 'Original', mentions: [mention] });
        expect(saved.thread.items[0]!.mentions).toEqual([mention]);
        await expect(editProjectCommentItem(project, owner, comment.id, 'first', { text: '@Alex', expectedText: '@Alex please check', mentions: [{ ...mention, end: 100 }] })).rejects.toMatchObject({ code: 'invalid_request' });
        await expect(replyToProjectComment(new Request('http://localhost'), project, guest, comment.id, { text: '@Alex', mentions: [mention] })).rejects.toMatchObject({ code: 'forbidden' });
        const appEdit = { ...saved, id: `comment_app_${key}` };
        await store.create(appEdit);
        expect((await editProjectCommentText(project, owner, appEdit.id, 'Before @Alex please check')).thread.items[0]!.mentions)
            .toEqual([{ ...mention, start: 7, end: 12 }]);
        await updateUserName(ids[2]!, 'Alex renamed');
        expect(toReviewCommentDto(saved, owner, new Map(), [], 0, await participantNames(project))?.thread.items[0]).toMatchObject({ mentions: [{ ...mention, name: 'Alex renamed' }] });
        await app.delete(workspacePk(project.workspaceId), memberId(ids[2]!));
        await expect(setProjectCommentAssignee(project, owner, comment.id, ids[2]!)).rejects.toMatchObject({ code: 'forbidden' });
        saved = await editProjectCommentItem(project, owner, comment.id, 'first', { text: '@Alex again', expectedText: '@Alex please check', mentions: [mention] });
        expect(saved.thread.items[0]!.mentions).toEqual([mention]);
        await expect(replyToProjectComment(new Request('http://localhost'), project, owner, comment.id, { text: '@Alex', mentions: [mention] })).rejects.toMatchObject({ code: 'forbidden' });
        const dto = toReviewCommentDto(saved, owner, new Map(), [], 0, await participantNames(project));
        expect(dto?.assignee).toMatchObject({ name: 'Former member', unavailable: true, isMe: false });
        expect(dto?.thread.items[0]).toMatchObject({ mentions: [{ ...mention, name: 'Former member' }] });
        const guestDto = toReviewCommentDto(saved, guest, new Map(), [], 0, await participantNames(project));
        expect(guestDto?.assignee?.id).toBeUndefined();
        expect(guestDto?.thread.items[0]).not.toHaveProperty('mentions');
        saved = await setProjectCommentAssignee(project, owner, comment.id, null);
        expect(saved.assigneeId).toBeUndefined();
        await setProjectCommentAssignee(project, owner, comment.id, ids[1]!);
        expect((await setProjectCommentPrivate(project, owner, comment.id, true)).assigneeId).toBeUndefined();
        const privateThread = (await store.get(comment.domain, comment.id))!.comment;
        expect(await eligibleParticipants(project, owner, privateThread)).toEqual([{ id: ids[0], name: 'Owner' }]);
        await expect(setProjectCommentAssignee(project, owner, comment.id, ids[1]!)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(eligibleParticipants(project, member, privateThread)).rejects.toMatchObject({ code: 'not_found' });
        await expect(editProjectCommentItem(project, owner, comment.id, 'first', { text: '@Alex', expectedText: '@Alex again', mentions: [{ ...mention, userId: ids[1]! }] })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(getProjectComment(project, member, comment.id)).rejects.toMatchObject({ code: 'not_found' });
        // Neither attempted assignment nor mention created or expanded a membership.
        expect((await app.get<DbMember>(workspacePk(project.workspaceId), memberId(ids[3]!)))?.doc.projects).toEqual(['another-project']);
        expect(await app.get(workspacePk(project.workspaceId), memberId(ids[2]!))).toBeNull();
        await app.delete(workspacePk(project.workspaceId), memberId(ids[0]!));
        await expect(setProjectCommentAssignee(project, owner, comment.id, null)).rejects.toMatchObject({ code: 'sign_in_required' });
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});

test('mention ranges survive edits around a selection and lose identity when the label is edited', () => {
    const mention = { userId: 'u_alex', start: 3, end: 8 };
    expect(moveMentions('Hi @Alex', 'Hey @Alex', [mention])).toEqual([{ ...mention, start: 4, end: 9 }]);
    expect(moveMentions('Hi @Alex', 'Hi @Ale', [mention])).toEqual([]);
    expect(moveMentions('Hi @Alex', 'Hi @Alex please', [mention])).toEqual([mention]);
    expect(mentionsSchema.safeParse(Array.from({ length: 21 }, () => mention)).success).toBe(false);
});

test('review assignment rejects invalid user ids before member reads and stores nothing', async () => {
    const previous = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = { id: `assignment-${randomUUID()}` } as DbProject;
        const actor = { kind: 'member', userId: 'u_owner', name: 'Owner', isAdmin: true } as const;
        const store = getMemoryCommentsStore();
        const comment: DbComment = { id: 'comment_assignment', domain: `project:${project.id}`, path: '/', position: { type: 'page' },
            thread: { items: [{ id: 'first', text: 'Feedback' }] } };
        await store.create(comment);
        const before = await store.get(comment.domain, comment.id);
        for (const assigneeId of ['', 'u_', 'u_bad/id', 'u_bad#id', 'u_bad?id', 'u_' + 'a'.repeat(65), 123, {}]) {
            // Exercise the route's JSON parser without unrelated project/auth fixtures.
            const request = new Request('http://localhost/assignee', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigneeId }) });
            const response = await assignReviewComment({ request, project, actor }, { id: comment.id }).catch(errorResponse);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ error: 'invalid_request' });
            await expect(setProjectCommentAssignee(project, actor, comment.id, assigneeId as string)).rejects.toMatchObject({ code: 'invalid_request' });
        }
        expect(await store.get(comment.domain, comment.id)).toEqual(before);
    } finally {
        if (previous === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previous;
    }
});
