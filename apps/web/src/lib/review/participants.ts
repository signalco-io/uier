import { z } from 'zod';
import type { DbComment, DbMention, DbThreadItem } from '../db/schema';
import type { DbProject } from '../app/model';
import { listProjectMembers } from '../app/members';
import { apiErrors } from '../comments/http';
import { memberActor, type ProjectActor } from './actor';
import { canSeeComment } from './comments';

export const mentionsSchema = z.array(z.object({
    userId: z.string().regex(/^u_[A-Za-z0-9_-]{1,64}$/),
    start: z.int().min(0).max(1000),
    end: z.int().min(1).max(1000)
})).max(20);

/** Account names and opaque ids only, never email addresses. Private threads narrow this list. */
export async function eligibleParticipants(project: DbProject, actor: ProjectActor, comment?: DbComment) {
    await assertParticipantEditor(project, actor, comment);
    return (await listProjectMembers(project.workspaceId, project.id))
        .filter(({ member, user }) => user && (!comment?.private || member.role === 'admin' || comment.authorId === `user:${member.userId}`))
        .map(({ member, name }) => ({ id: member.userId, name }));
}

export async function assertParticipantEditor(project: DbProject, actor: ProjectActor, comment?: DbComment) {
    const current = actor.kind === 'member' ? await memberActor(project, actor.userId) : null;
    if (!current) throw apiErrors.forbidden('Sign in to choose project participants.');
    if (comment && !canSeeComment(comment, current)) throw apiErrors.notFound();
}

/** Recheck current membership and thread visibility at mutation time, including optimistic retries. */
export async function assertEligibleParticipant(project: DbProject, comment: DbComment, userId: string) {
    const recipient = await memberActor(project, userId);
    if (!recipient || !canSeeComment(comment, recipient))
        throw apiErrors.forbidden('Choose someone who still has access to this thread.');
}

export async function validateMentions(project: DbProject, actor: ProjectActor, comment: DbComment, text: string, mentions: DbMention[] = [], previous?: DbThreadItem) {
    if (!mentions.length) return [];
    await assertParticipantEditor(project, actor, comment);
    let end = 0;
    for (const mention of mentions) {
        if (mention.start < end || mention.end <= mention.start + 1 || mention.end > text.length || text[mention.start] !== '@')
            throw apiErrors.invalidRequest('Mention ranges must match the message.');
        end = mention.end;
        const retained = previous?.mentions?.some(old => old.userId === mention.userId
            && previous.text.slice(old.start, old.end) === text.slice(mention.start, mention.end));
        // Historical selections can stay after someone loses access. They never become new targets.
        if (!retained) await assertEligibleParticipant(project, comment, mention.userId);
    }
    return mentions;
}
