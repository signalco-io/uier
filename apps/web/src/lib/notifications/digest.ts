import type { DbProject } from '../app/model';
import type { DbComment } from '../db/schema';
import { itemAuthorName } from '../review/dto';
import type { NotificationEvent } from './delivery';

// Each untrusted subject component is below MAX_NAME_LENGTH (80). See the delivery guide.
const SUBJECT_COMPONENT_LIMIT = 60;
const EXCERPT_LIMIT = 160;
const MAX_DIGEST_LINES = 10;

function plainLabel(value: string, limit = SUBJECT_COMPONENT_LIMIT) {
    const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const characters = Array.from(clean);
    return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : clean;
}

/** Only the recipient's eligible batch may reach this formatter. Never expand recipients. */
export function digestContent(project: DbProject, comment: DbComment, recipient: string, batch: NotificationEvent[], names: Map<string, string>) {
    // The subject describes the page, never its approved query/hash state. Links keep that state.
    const path = plainLabel(comment.path.split(/[?#]/, 1)[0] || '/');
    const thread = comment.number ? `#${comment.number}` : path;
    const place = comment.number ? `${thread} (${path})` : path;
    const actionLines: string[] = [];
    const lines = batch.slice(0, MAX_DIGEST_LINES).map(event => {
        const member = event.actorId.startsWith('user:');
        const item = event.itemId ? comment.thread.items.find(item => item.id === event.itemId)
            : [...comment.thread.items].reverse().find(item => item.authorId === event.actorId);
        const authorName = item?.authorId === event.actorId && !item.deletedAt ? item.authorName : undefined;
        const name = plainLabel(itemAuthorName({ authorId: event.actorId, authorName }, names)) || (member ? 'Former member' : 'Guest');
        const actor = `${name}${member ? '' : ' (guest)'}${event.agent ? ` via ${plainLabel(event.agent.name) || 'Connector'}` : ''}`;
        const mentioned = event.kind === 'mention' || ((event.kind === 'comment' || event.kind === 'reply') && event.recipients?.includes(recipient));
        let action: string;
        if (mentioned) action = `mentioned you on ${place}`;
        else if (event.kind === 'assignment') {
            const location = comment.number ? ` (${path})` : '';
            action = event.assigneeId === recipient.slice('user:'.length) ? `assigned ${thread} to you${location}`
                : event.assigneeId !== undefined ? `unassigned you from ${thread}${location}` : `updated your assignment on ${place}`;
        } else action = `${event.kind === 'comment' ? 'left feedback on' : event.kind === 'reply' ? 'replied on' : event.kind === 'resolved' ? 'resolved' : 'reopened'} ${place}`;
        actionLines.push(`${actor} ${action}`);
        const excerpt = project.emailCommentExcerpts && event.itemId && item && !item.deletedAt
            && (event.kind === 'comment' || event.kind === 'reply' || event.kind === 'mention') ? plainLabel(item.text, EXCERPT_LIMIT) : '';
        return `${actor} ${action}${excerpt ? ` — “${excerpt}”` : ''}`;
    });
    const actors = new Set(batch.map(event => event.actorId)).size;
    // Single-event subjects use the same action line without any optional comment text.
    const summary = batch.length === 1
        ? actionLines[0]!
        : `${batch.length} updates${actors > 1 ? ` from ${actors} people` : ''} on ${place}`;
    if (batch.length > MAX_DIGEST_LINES) lines.push(`and ${batch.length - MAX_DIGEST_LINES} more`);
    const title = plainLabel(project.name) || 'Project';
    return { subject: `${title}: ${summary}`, title, lines };
}
