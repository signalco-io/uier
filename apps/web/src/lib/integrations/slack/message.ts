import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';
import { slackLabel } from './config';

const literal = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const limit = (value: string, max: number) => Array.from(value).slice(0, max).join('');

/** Reviewer text stays plain_text; generated links never interpolate a reviewer-supplied label. */
export function slackRootMessage(context: FeedbackContext, projectName: string, baseUrl = 'https://uier.io') {
    const number = context.identity.number ? `#${context.identity.number}` : 'Feedback';
    const title = limit(literal(`${slackLabel(projectName) || 'Project'} · ${number} · ${context.kind === 'rewrite' ? 'Suggested rewrite' : context.kind === 'bug' ? 'Bug' : 'Feedback'} · ${context.status === 'done' ? 'Done' : 'Open'}`), 180);
    let excerpt = limit(literal(context.feedback?.deleted ? 'This message was deleted.'
        : `${context.kind === 'rewrite' ? 'Suggested rewrite: ' : ''}${context.feedback?.text ?? 'Feedback is unavailable.'}`), 500);
    const environment = context.source.environment ? limit(literal(`Environment: ${slackLabel(context.source.environment)}`), 100) : '';
    let reviewLink: string | undefined;
    if (context.identity.projectId && /^[a-z0-9]{12}$/.test(context.identity.projectId)) {
        const url = new URL(`/app/review/${context.identity.projectId}`, baseUrl);
        url.searchParams.set('comment', context.identity.commentId);
        if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 256) reviewLink = url.href;
    }
    function render() {
        const text = [title, excerpt || 'Open the feedback in uier.', environment, reviewLink ? `Open in uier: ${literal(reviewLink)}` : 'Open the project in uier to view this feedback.'].filter(Boolean).join('\n');
        const blocks: Record<string, unknown>[] = [
            { type: 'section', text: { type: 'plain_text', text: title, emoji: false } },
            { type: 'section', text: { type: 'plain_text', text: excerpt || 'Open the feedback in uier.', emoji: false } }
        ];
        if (environment) blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: environment, emoji: false }] });
        if (reviewLink) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in uier', emoji: false }, url: reviewLink }] });
        return { text, blocks, mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false };
    }
    let payload = render();
    // The fallback and Block Kit both contain the excerpt; budget their combined serialized size.
    while (JSON.stringify(payload).length > 2500 && excerpt.length > 0) { excerpt = limit(excerpt, Math.max(0, Array.from(excerpt).length - 50)); payload = render(); }
    return { payload, hash: sha256Hex(JSON.stringify(payload)) };
}

export function slackChangeSummary(status: FeedbackContext['status'] | undefined, replies: number) {
    const text = [status ? `Status: ${status === 'done' ? 'Done' : 'Open'}.` : '', replies ? `${replies} new ${replies === 1 ? 'reply' : 'replies'} in uier.` : ''].filter(Boolean).join(' ');
    const payload = { text, blocks: [{ type: 'section', text: { type: 'plain_text', text, emoji: false } }],
        mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false, reply_broadcast: false };
    return { payload, hash: sha256Hex(JSON.stringify(payload)) };
}
