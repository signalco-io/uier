import { feedbackMarkdown, type FeedbackContext, type FeedbackMessage } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';
import type { LinearIssueGeneration } from './model';

const plain = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/([\\`*_{}\[\]<>()#!|>~@])/g, '\\$1');
function literal(value: string) { const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1))); return `${fence}text\n${value}\n${fence}`; }
export const linearMarker = (connectionId: string, projectId: string, threadId: string, generation: number) =>
    `uier-source:${sha256Hex(JSON.stringify([connectionId, projectId, threadId, generation]))}`;
export const linearCommentMarker = (issue: LinearIssueGeneration, itemId: string) => `uier-reply:${sha256Hex(`${issue.marker}:${itemId}`)}`;

export function linearIssueProjection(context: FeedbackContext, issue: LinearIssueGeneration) {
    const copy: FeedbackContext = { ...context, discussion: [], ...(issue.screenshot ? { screenshot: { state: 'unavailable' as const } } : {}) };
    const markdown = feedbackMarkdown(copy) + (context.assignee ? '' : '\nAssignee: Unassigned\n')
        + '\nDiscussion is mirrored in separate app-owned comments. Changes are managed in uier.\n'
        + (issue.screenshot ? `\n![Saved screenshot](<${issue.screenshot.assetUrl}>)\n` : '') + `\n${issue.marker}\n`;
    // Never turn a large packet into an undocumented provider-limit failure or a complete-mirror claim.
    if (markdown.length > 50_000) return { title: context.title.slice(0, 100), description:
        `${literal((context.feedback?.text ?? 'Unavailable feedback').slice(0, 5000))}\n\nThis thread is too large to mirror completely. Read the current thread in uier.\n\n`
        + (context.links.comment ? `[Open feedback in uier](<${context.links.comment}>)\n\n` : '') + issue.marker, truncated: true };
    return { title: context.title.slice(0, 100), description: markdown, truncated: false };
}

export function linearCommentProjection(message: FeedbackMessage, marker: string) {
    const text = message.deleted ? 'This reply was deleted in uier.' : message.text ?? '';
    const metadata = [message.authorName, message.createdAt, message.editedAt ? `Edited ${message.editedAt}` : undefined].filter(Boolean).map(value => plain(value!.slice(0, 200))).join(' · ');
    return `${metadata}\n\n${literal(text.slice(0, 40_000))}${text.length > 40_000 ? '\n\nThis reply was shortened. Read its full saved text in uier.' : ''}\n\n${marker}`;
}
