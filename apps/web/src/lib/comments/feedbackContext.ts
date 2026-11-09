import { feedbackMarkdown, type FeedbackContext, type FeedbackExport, type FeedbackMessage } from '@uier/toolbar/feedback-context';
import { feedbackStage } from '@uier/toolbar/verification';
import type { CommentDto } from './dto';
import type { ReproductionContext } from './reproduction';
import type { DbCommentLayer } from '../db/schema';

/** The element that opens the anchor's menu, popover or dialog */
function opener(layer: DbCommentLayer | undefined): Pick<FeedbackContext['anchor'], 'opener'> {
    return layer ? { opener: { selector: layer.opener, ...(layer.label ? { label: layer.label } : {}) } } : {};
}

/** Input must already have passed visibility checks and DTO projection. Never accept a DbComment here. */
type ExportItem = CommentDto['thread']['items'][number] & { agent?: import('@uier/toolbar/agents').MessageAgentView };

export function feedbackExport(dto: Omit<CommentDto, 'thread'> & { thread: { items: ExportItem[] }; reproduction?: ReproductionContext }, options: {
    projectId?: string;
    environment?: string;
    pageUrl?: string;
    commentUrl?: string;
    screenshotUrl?: string;
    assigneeName?: string;
    /** The AI agent working under the assignee (members only) */
    assigneeAgent?: import('@uier/toolbar/agents').AssigneeAgentView;
    /** The thread's AI title (`lib/titles`), used in place of the summary while the first message is there */
    title?: string;
}): FeedbackExport {
    const items: FeedbackMessage[] = dto.thread.items.map(item => 'deleted' in item
        ? { id: item.id, deleted: true, createdAt: item.createdAt }
        : { id: item.id, deleted: false, text: item.text, quotedText: item.quotedText, authorName: item.author.name, createdAt: item.createdAt, editedAt: item.editedAt,
            ...('agent' in item && item.agent ? { agent: { kind: item.agent.kind, label: item.agent.label,
                ...(item.agent.model ? { model: item.agent.model } : {}), ...(item.agent.reasoning ? { reasoning: item.agent.reasoning } : {}) } } : {}) });
    const first = items[0] ?? null;
    const available = first && !first.deleted;
    const position = dto.position;
    const r = dto.reproduction;
    const summary = available ? first.text?.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 100) : first?.deleted ? 'Deleted feedback' : 'Unavailable feedback';
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted',
        identity: { projectId: options.projectId, commentId: dto.id, number: dto.number, itemId: first?.id },
        title: `${dto.kind === 'rewrite' ? 'Suggested rewrite: ' : ''}${(available && options.title) || summary || 'Website feedback'}`,
        verification: dto.verification, priority: dto.priority, kind: dto.kind, status: dto.resolved ? 'done' : 'open', stage: feedbackStage(dto), feedback: first,
        ...(options.assigneeName ? { assignee: { name: options.assigneeName, ...(options.assigneeAgent ? { agent: {
            kind: options.assigneeAgent.kind, label: options.assigneeAgent.label,
            ...(options.assigneeAgent.model ? { model: options.assigneeAgent.model } : {}),
            ...(options.assigneeAgent.reasoning ? { reasoning: options.assigneeAgent.reasoning } : {}),
            ...(options.assigneeAgent.sessionId ? { sessionId: options.assigneeAgent.sessionId } : {})
        } } : {}) } } : {}),
        anchor: !available || position.type === 'page' ? { type: position.type }
            : position.type === 'point' ? {
                type: 'point', selector: position.selector,
                ...(position.widthNormal !== undefined && position.heightNormal !== undefined
                    ? { area: { x: position.xNormal, y: position.yNormal, width: position.widthNormal, height: position.heightNormal } }
                    : {}),
                ...opener(position.layer)
            }
            : { type: 'text', selector: position.startSelector, text: position.text, startOffset: position.startOffset, endOffset: position.endOffset, endSelector: position.endSelector, ...opener(position.layer) },
        source: { path: dto.path, ...(options.environment ? { environment: options.environment } : {}), ...(options.pageUrl ? { origin: new URL(options.pageUrl).origin } : {}) },
        links: { page: options.pageUrl, comment: options.commentUrl },
        reproduction: available ? {
            device: dto.device?.size, windowSize: dto.device?.windowSize,
            ...(r ? {
                browser: r.browser, os: r.os, model: r.model, windowSize: r.windowSize ?? dto.device?.windowSize, pixelRatio: r.pixelRatio,
                input: r.input, colorScheme: r.colorScheme, reducedMotion: r.reducedMotion, pageLanguage: r.pageLanguage, capturedAt: r.capturedAt
            } : {})
        } : {},
        screenshot: available && dto.screenshot && options.screenshotUrl
            ? { state: 'protected', url: options.screenshotUrl, width: dto.screenshot.width, height: dto.screenshot.height, revision: dto.screenshot.revision }
            : { state: 'unavailable' },
        discussion: items.slice(1),
        notes: ['Text is the current saved version. Edited messages are labeled; prior versions are not retained.', ...(!available ? ['Original anchor details, device context and image are omitted because the first message is missing or deleted.'] : [])]
    };
    return { context, markdown: feedbackMarkdown(context) };
}
