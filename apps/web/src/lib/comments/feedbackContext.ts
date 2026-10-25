import { feedbackMarkdown, type FeedbackContext, type FeedbackExport, type FeedbackMessage } from '@uier/toolbar/feedback-context';
import type { CommentDto } from './dto';
import type { ReproductionContext } from './reproduction';

/** Input must already have passed visibility checks and DTO projection. Never accept a DbComment here. */
export function feedbackExport(dto: CommentDto & { reproduction?: ReproductionContext }, options: {
    projectId?: string;
    environment?: string;
    pageUrl?: string;
    commentUrl?: string;
    screenshotUrl?: string;
}): FeedbackExport {
    const items: FeedbackMessage[] = dto.thread.items.map(item => 'deleted' in item
        ? { id: item.id, deleted: true, createdAt: item.createdAt }
        : { id: item.id, deleted: false, text: item.text, quotedText: item.quotedText, authorName: item.author.name, createdAt: item.createdAt, editedAt: item.editedAt });
    const first = items[0] ?? null;
    const available = first && !first.deleted;
    const position = dto.position;
    const r = dto.reproduction;
    const summary = available ? first.text?.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 100) : first?.deleted ? 'Deleted feedback' : 'Unavailable feedback';
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted',
        identity: { projectId: options.projectId, commentId: dto.id, number: dto.number, itemId: first?.id },
        title: `${dto.kind === 'rewrite' ? 'Suggested rewrite: ' : ''}${summary || 'Website feedback'}`,
        kind: dto.kind, status: dto.resolved ? 'done' : 'open', feedback: first,
        anchor: !available || position.type === 'page' ? { type: position.type }
            : position.type === 'point' ? { type: 'point', selector: position.selector }
            : { type: 'text', selector: position.startSelector, text: position.text, startOffset: position.startOffset, endOffset: position.endOffset, endSelector: position.endSelector },
        source: { path: dto.path, ...(options.environment ? { environment: options.environment } : {}), ...(options.pageUrl ? { origin: new URL(options.pageUrl).origin } : {}) },
        links: { page: options.pageUrl, comment: options.commentUrl },
        reproduction: available ? {
            device: dto.device?.size, windowSize: dto.device?.windowSize,
            ...(r ? { browser: r.browser, os: r.os, windowSize: r.windowSize ?? dto.device?.windowSize, pixelRatio: r.pixelRatio, capturedAt: r.capturedAt } : {})
        } : {},
        screenshot: available && dto.screenshot && options.screenshotUrl
            ? { state: 'protected', url: options.screenshotUrl, width: dto.screenshot.width, height: dto.screenshot.height, revision: dto.screenshot.revision }
            : { state: 'unavailable' },
        discussion: items.slice(1),
        notes: ['Text is the current saved version. Edited messages are labeled; prior versions are not retained.', ...(!available ? ['Original anchor details, device context and image are omitted because the first message is missing or deleted.'] : [])]
    };
    return { context, markdown: feedbackMarkdown(context) };
}
