import { commentPriority, priorityLabels } from '@uier/toolbar/triage';
import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';
import { verificationText } from '../../comments/verificationText';
import type { AppI18n } from '../../i18n/types';
import type { ReplyPayload } from '../replies';
import { slackLabel } from './config';
import { englishSlackI18n } from './i18n';

const literal = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const limit = (value: string, max: number) => Array.from(value).slice(0, max).join('');
/** Slack documents no escaping for rich text elements. Without angle brackets a label is inert however Slack reads it. */
const richLabel = (value: string) => value.replace(/</g, '‹').replace(/>/g, '›');
/** Holds the thread's place while its sentence is translated. Labels never contain control characters. */
const slot = '\u0001';

/**
 * One card per thread: a heading that links to it, the reviewer's words, then one line of status,
 * priority, page and environment. Reviewer text stays plain_text; the heading's rich text holds only
 * the thread number and the admin's own type and project labels, never reviewer text.
 */
export function slackRootMessage(context: FeedbackContext, projectName: string, baseUrl = 'https://uier.io', i18n: AppI18n = englishSlackI18n) {
    const { t, language } = i18n;
    const kind = context.kind.startsWith('custom_') ? slackLabel(context.feedbackType?.label) || t('Feedback')
        : t(context.kind === 'rewrite' ? 'Suggested rewrite' : context.kind === 'bug' ? 'Bug' : 'Feedback');
    const name = `${kind}${context.identity.number ? ` #${context.identity.number}` : ''}`;
    // Word order differs by language: the sentence is translated whole, then the linked name takes its place in it.
    const [before = '', after = ''] = t('{thread} in {project}', { thread: slot, project: slackLabel(projectName) || t('Project') }).split(slot);
    let excerpt = limit(literal(context.feedback?.deleted ? t('This message was deleted.')
        : context.kind === 'rewrite' ? t('Suggested rewrite: {text}', { text: context.feedback?.text ?? t('Feedback is unavailable.') })
            : context.feedback?.text ?? t('Feedback is unavailable.')), 500);
    const verification = context.verification ? limit(literal(verificationText(context.verification, t, language)), 500) : '';
    const priority = commentPriority(context.priority);
    const path = slackLabel(context.source.path);
    // The default priority says nothing, so only the others are named.
    const details = literal([t(context.status === 'done' ? 'Done' : 'Open'), priority === 'normal' ? '' : t('Priority: {priority}', { priority: t(priorityLabels[priority]) }),
        Array.from(path).length > 60 ? `${limit(path, 59)}…` : path, slackLabel(context.source.environment)].filter(Boolean).join(' · '));
    let reviewLink: string | undefined;
    if (context.identity.projectId && /^[a-z0-9]{12}$/.test(context.identity.projectId)) {
        const url = new URL(`/app/review/${context.identity.projectId}`, baseUrl);
        url.searchParams.set('comment', context.identity.commentId);
        if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 256) reviewLink = url.href;
    }
    function render() {
        const text = [literal(before + name + after), excerpt || t('Open the feedback in uier.'), details, verification,
            reviewLink ? t('Open in uier: {url}', { url: literal(reviewLink) }) : t('Open the project in uier to view this feedback.')].filter(Boolean).join('\n');
        const blocks: Record<string, unknown>[] = [
            { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
                ...(before ? [{ type: 'text', text: richLabel(before) }] : []),
                { type: reviewLink ? 'link' : 'text', ...(reviewLink ? { url: reviewLink } : {}), text: richLabel(name), style: { bold: true } },
                ...(after ? [{ type: 'text', text: richLabel(after) }] : [])
            ] }] },
            { type: 'section', text: { type: 'plain_text', text: excerpt || t('Open the feedback in uier.'), emoji: false } },
            { type: 'context', elements: [{ type: 'plain_text', text: details, emoji: false }] }
        ];
        if (verification) blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: verification, emoji: false }] });
        if (reviewLink) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: t('Open in uier'), emoji: false }, url: reviewLink }] });
        return { text, blocks, mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false };
    }
    let payload = render();
    // The fallback and Block Kit both contain the excerpt; budget their combined serialized size.
    while (JSON.stringify(payload).length > 2500 && excerpt.length > 0) { excerpt = limit(excerpt, Math.max(0, Array.from(excerpt).length - 50)); payload = render(); }
    return { payload, hash: sha256Hex(JSON.stringify(payload)) };
}

export function slackChangeSummary(status: FeedbackContext['status'] | undefined, replies: number, i18n: AppI18n = englishSlackI18n) {
    const { t, language } = i18n;
    const text = [status ? t('Status: {status}.', { status: t(status === 'done' ? 'Done' : 'Open') }) : '',
        replies ? replies === 1 ? t('1 new reply in uier.') : t('{count} new replies in uier.', { count: new Intl.NumberFormat(language).format(replies) }) : ''].filter(Boolean).join(' ');
    const payload = { text, blocks: [{ type: 'section', text: { type: 'plain_text', text, emoji: false } }],
        mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false, reply_broadcast: false };
    return { payload, hash: sha256Hex(JSON.stringify(payload)) };
}

/** Only the attribution and link label are translated; author names, text and reconciliation markers stay literal. */
export function slackReplyMessage(payload: ReplyPayload, { t }: AppI18n = englishSlackI18n) {
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `${t('{author} via uier:', { author: escape(payload.author) })}\n\n${escape(payload.text)}\n\n<${payload.url}|${t('View in uier')}>`;
}
