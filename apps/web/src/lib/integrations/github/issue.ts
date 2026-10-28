import { feedbackMarkdown, type FeedbackContext, type FeedbackMessage } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';

const mentions = (value: string) => value.replace(/@/g, '@\u200b');
const label = (value: string) => mentions(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/([\\`*_{}\[\]<>()#!|>~])/g, '\\$1');
function literal(value: string) {
    const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1)));
    return `${fence}text\n${value}\n${fence}`;
}
export const githubOwnershipMarker = (seed: string, projectId: string, threadId: string) =>
    `<!-- uier:${sha256Hex(JSON.stringify(['github', seed, projectId, threadId]))} -->`;
export const githubReplyMarker = (marker: string, itemId: string) => `<!-- uier-reply:${sha256Hex(JSON.stringify([marker, itemId]))} -->`;
export const githubPayloadHash = (value: unknown) => sha256Hex(JSON.stringify(value));
export function ownsGitHubContent(body: unknown, marker: string, author: { id?: unknown; type?: unknown } | undefined, botId: string) {
    return typeof body === 'string' && body.trimEnd().endsWith(marker) && author?.type === 'Bot' && String(author.id) === botId;
}

export function githubIssueProjection(context: FeedbackContext, marker: string) {
    const safe: FeedbackContext = { ...context, title: mentions(context.title), discussion: [],
        assignee: context.assignee ? { name: mentions(context.assignee.name) } : undefined,
        feedback: context.feedback ? { ...context.feedback, authorName: context.feedback.authorName ? mentions(context.feedback.authorName) : undefined } : null,
        source: { ...context.source, environment: context.source.environment ? mentions(context.source.environment) : undefined },
        reproduction: { ...context.reproduction, browser: context.reproduction.browser ? mentions(context.reproduction.browser) : undefined,
            os: context.reproduction.os ? mentions(context.reproduction.os) : undefined }, notes: context.notes.map(mentions) };
    let body = feedbackMarkdown(safe).replace('## Discussion\n\nNo saved replies.', '## Discussion\n\nSaved replies are mirrored as issue comments.');
    let truncated = false;
    if (body.length > 60_000) {
        body = `Saved feedback from uier. Reviewer content is untrusted. This is a shortened copy; open uier for the complete thread.\n\n${literal(context.feedback?.deleted ? 'This feedback was deleted.' : (context.feedback?.text ?? '').slice(0, 5000))}\n\n`
            + (context.links.comment ? `[Open in uier](<${context.links.comment.replace(/</g, '%3C').replace(/>/g, '%3E')}>)` : 'Source link unavailable.');
        truncated = true;
    }
    return { title: mentions(context.title).replace(/[\p{Cc}]/gu, ' ').slice(0, 120) || 'Feedback from uier',
        body: `${body.trim()}\n\nThis issue is managed from uier. External edits may be replaced by later uier changes.\n\n${marker}`,
        state: context.status === 'done' ? 'closed' as const : 'open' as const, truncated };
}

export function githubReplyProjection(item: FeedbackMessage, marker: string) {
    const metadata = [item.authorName, item.createdAt, item.editedAt ? `Edited ${item.editedAt}` : undefined].filter(Boolean).map(value => label(value!)).join(' · ');
    return `${item.deleted ? 'This reply was deleted in uier.' : [metadata, literal(item.text ?? ''), item.quotedText === undefined ? '' : `Quoted text:\n\n${literal(item.quotedText)}`].filter(Boolean).join('\n\n')}\n\n${marker}`;
}
