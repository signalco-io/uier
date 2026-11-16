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

/** Reviewer text stays plain_text; generated links never interpolate a reviewer-supplied label. */
export function slackRootMessage(context: FeedbackContext, projectName: string, baseUrl = 'https://uier.io', i18n: AppI18n = englishSlackI18n) {
    const { t, language } = i18n;
    const number = context.identity.number ? `#${context.identity.number}` : t('Feedback');
    const kind = context.kind.startsWith('custom_') ? context.feedbackType?.label ?? t('Feedback')
        : t(context.kind === 'rewrite' ? 'Suggested rewrite' : context.kind === 'bug' ? 'Bug' : 'Feedback');
    const title = limit(literal(`${slackLabel(projectName) || t('Project')} · ${number} · ${kind} · ${t(context.status === 'done' ? 'Done' : 'Open')}`), 180);
    let excerpt = limit(literal(context.feedback?.deleted ? t('This message was deleted.')
        : context.kind === 'rewrite' ? t('Suggested rewrite: {text}', { text: context.feedback?.text ?? t('Feedback is unavailable.') })
            : context.feedback?.text ?? t('Feedback is unavailable.')), 500);
    const verification = context.verification ? limit(literal(verificationText(context.verification, t, language)), 500) : '';
    const priority = t('Priority: {priority}', { priority: t(priorityLabels[commentPriority(context.priority)]) });
    const environment = context.source.environment ? limit(literal(t('Environment: {environment}', { environment: slackLabel(context.source.environment) })), 100) : '';
    let reviewLink: string | undefined;
    if (context.identity.projectId && /^[a-z0-9]{12}$/.test(context.identity.projectId)) {
        const url = new URL(`/app/review/${context.identity.projectId}`, baseUrl);
        url.searchParams.set('comment', context.identity.commentId);
        if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 256) reviewLink = url.href;
    }
    function render() {
        const text = [title, excerpt || t('Open the feedback in uier.'), priority, verification, environment,
            reviewLink ? t('Open in uier: {url}', { url: literal(reviewLink) }) : t('Open the project in uier to view this feedback.')].filter(Boolean).join('\n');
        const blocks: Record<string, unknown>[] = [
            { type: 'section', text: { type: 'plain_text', text: title, emoji: false } },
            { type: 'section', text: { type: 'plain_text', text: excerpt || t('Open the feedback in uier.'), emoji: false } }
        ];
        blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: priority, emoji: false }] });
        if (verification) blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: verification, emoji: false }] });
        if (environment) blocks.push({ type: 'context', elements: [{ type: 'plain_text', text: environment, emoji: false }] });
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
