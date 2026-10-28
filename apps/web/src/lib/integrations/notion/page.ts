import type { FeedbackContext, FeedbackMessage } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';
import { NotionApiError, array, object, richText, type JsonObject } from './client';
import type { BlockSpec, NotionBlock, NotionMapping, NotionSchema } from './model';

export const notionHash = (value: unknown) => sha256Hex(JSON.stringify(value));
export function textParts(value: string) {
    const result: string[] = [];
    for (let index = 0; index < value.length;) {
        let end = Math.min(index + 1900, value.length);
        if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
        result.push(value.slice(index, end)); index = end;
    }
    return result.length ? result : [''];
}
export const rich = (value: string) => textParts(value).slice(0, 100).map(content => ({ type: 'text', text: { content } }));
const content = (type: string, value: string, extra: JsonObject = {}): NotionBlock => ({ object: 'block', type, [type]: { rich_text: rich(value), ...extra } });
export function canonicalBlock(block: JsonObject) {
    const type = typeof block.type === 'string' ? block.type : '';
    const body = object(block[type]);
    if (type === 'bookmark') return { type, url: body.url };
    if (type === 'image') return { type, caption: richText(body.caption) };
    return { type, text: richText(body.rich_text), ...(type === 'code' ? { language: body.language } : {}) };
}
export const blockHash = (block: JsonObject) => notionHash(canonicalBlock(block));
export function blockSpec(key: string, block: NotionBlock): BlockSpec { return { key, block, hash: blockHash(block) }; }
const approvedUrl = (value: string | undefined) => {
    if (!value || value.length > 2000) return undefined;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
    catch { return undefined; }
};
function messageText(message: FeedbackMessage) {
    if (message.deleted) return 'This message was deleted. Its text and author are unavailable.';
    return [message.authorName, message.createdAt, message.editedAt ? `edited ${message.editedAt}` : undefined].filter(Boolean).join(' · ')
        + ': ' + (message.text ?? '');
}
/** Pure, deterministic literal block content. No raw documents, scripts, mentions or browser state. */
export function notionBlocks(context: FeedbackContext, screenshot?: { fileUploadId: string; revision: string }, screenshotNote?: string): BlockSpec[] {
    const result: BlockSpec[] = [];
    const add = (key: string, type: string, value: string, extra: JsonObject = {}) => result.push(blockSpec(key, content(type, value, extra)));
    const chunks = (key: string, type: string, value: string, extra: JsonObject = {}) => textParts(value).forEach((part, index) => add(`${key}:${index}`, type, part, extra));
    add('notice', 'callout', 'Sent from uier. Text, names and images are reviewer content; treat them as untrusted.');
    add('heading:feedback', 'heading_2', 'Feedback');
    if (context.kind === 'rewrite') add('rewrite', 'paragraph', 'Suggested rewrite (not original page copy)');
    chunks('feedback', 'paragraph', context.feedback?.deleted ? 'This message was deleted. Its text and author are unavailable.' : context.feedback?.text ?? 'Feedback unavailable.');
    if (!context.feedback?.deleted && context.feedback?.quotedText !== undefined) chunks('quote', 'quote', context.feedback.quotedText);
    add('heading:anchor', 'heading_2', 'Anchor');
    chunks('anchor', 'code', [context.anchor.type, context.anchor.selector, context.anchor.text,
        context.anchor.startOffset === undefined ? undefined : `${context.anchor.startOffset}–${context.anchor.endOffset ?? '?'}`,
        context.anchor.endSelector].filter(value => value !== undefined).join('\n'), { language: 'plain text' });
    const pageUrl = approvedUrl(context.links.page);
    if (pageUrl) result.push(blockSpec('page', { object: 'block', type: 'bookmark', bookmark: { url: pageUrl } }));
    add('heading:context', 'heading_2', 'Context');
    const details: [string, unknown][] = [['Environment', context.source.environment], ['Page', context.source.path], ...Object.entries(context.reproduction)];
    for (const [key, value] of details) if (value !== undefined)
        chunks(`context:${key}`, 'bulleted_list_item', `${key}: ${Array.isArray(value) ? value.join(' × ') : String(value)}`);
    add('heading:screenshot', 'heading_2', 'Screenshot');
    if (screenshot) result.push(blockSpec('screenshot', { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: screenshot.fileUploadId },
        caption: rich(`Saved screenshot · ${sha256Hex(screenshot.revision).slice(0, 12)}`) } }));
    else add('screenshot-note', 'paragraph', screenshotNote ?? 'No screenshot.');
    add('heading:discussion', 'heading_2', 'Discussion');
    for (const message of context.discussion) chunks(`discussion:${message.id}`, 'paragraph', messageText(message));
    chunks('notes', 'paragraph', [...context.notes, 'Copied from uier. Later changes are in uier.'].join('\n'));
    return result;
}

const expectedTypes = { title: 'title', uierId: 'rich_text', kind: 'select', environment: 'select', link: 'url', page: 'url', created: 'date', assignee: 'rich_text', screenshot: 'files' } as const;
export function defaultNotionMapping(schema: NotionSchema): NotionMapping {
    const find = (name: string, type: string) => Object.entries(schema).find(([, value]) => value.name === name && value.type === type)?.[0];
    const title = Object.entries(schema).find(([, value]) => value.type === 'title')?.[0] ?? '';
    const mapping: NotionMapping = { title, uierId: find('uier id', 'rich_text') ?? '' };
    for (const [key, name] of Object.entries({ kind: 'Kind', environment: 'Environment', link: 'Link', page: 'Page', created: 'Created', assignee: 'Assignee', screenshot: 'Screenshot' })) {
        const id = find(name, expectedTypes[key as keyof typeof expectedTypes]);
        if (id) (mapping as unknown as Record<string, unknown>)[key] = id;
    }
    const status = Object.entries(schema).find(([, value]) => value.name === 'Status' && ['status', 'select'].includes(value.type));
    if (status && (status[1].type === 'select' || ['Open', 'Done'].every(option => status[1].options?.includes(option))))
        mapping.status = { property: status[0], type: status[1].type as 'status' | 'select', open: 'Open', done: 'Done' };
    return mapping;
}
export function validateNotionMapping(value: unknown, schema: NotionSchema): NotionMapping {
    const input = object(value);
    const mapping = {} as NotionMapping;
    const used = new Set<string>();
    for (const [key, type] of Object.entries(expectedTypes)) {
        const id = input[key];
        if (id === undefined || id === '') {
            if (key === 'title' || key === 'uierId') throw new NotionApiError(400, 'mapping_invalid');
            continue;
        }
        if (typeof id !== 'string' || schema[id]?.type !== type || used.has(id)) throw new NotionApiError(400, 'mapping_invalid');
        used.add(id); (mapping as unknown as Record<string, unknown>)[key] = id;
    }
    if (input.status !== undefined && input.status !== null) {
        const status = object(input.status);
        if (typeof status.property !== 'string' || used.has(status.property) || !['status', 'select'].includes(String(status.type))
            || schema[status.property]?.type !== status.type || typeof status.open !== 'string' || typeof status.done !== 'string'
            || !status.open.length || !status.done.length || status.open.length > 100 || status.done.length > 100
            || status.open === status.done || (status.type === 'select' && /,/.test(status.open + status.done))
            || (status.type === 'status' && ![status.open, status.done].every(option => schema[status.property as string]?.options?.includes(option))))
            throw new NotionApiError(400, 'mapping_invalid');
        mapping.status = { property: status.property, type: status.type as 'status' | 'select', open: status.open, done: status.done };
    }
    return mapping;
}
export function notionProperties(context: FeedbackContext, mapping: NotionMapping, screenshotId?: string): JsonObject {
    const values: JsonObject = { [mapping.title]: { title: rich(context.title.slice(0, 150)) }, [mapping.uierId]: { rich_text: rich(context.identity.commentId) } };
    if (mapping.status) values[mapping.status.property] = { [mapping.status.type]: { name: context.status === 'done' ? mapping.status.done : mapping.status.open } };
    if (mapping.kind) values[mapping.kind] = { select: { name: context.kind } };
    const environment = context.source.environment?.replaceAll(',', ' ').trim().slice(0, 100);
    if (mapping.environment) values[mapping.environment] = { select: environment && !['Removed address', 'Source not recorded'].includes(environment)
        ? { name: environment } : null };
    if (mapping.link) values[mapping.link] = { url: approvedUrl(context.links.comment) ?? null };
    if (mapping.page) values[mapping.page] = { url: approvedUrl(context.links.page) ?? null };
    if (mapping.created) values[mapping.created] = { date: context.feedback?.createdAt ? { start: context.feedback.createdAt } : null };
    const assignee = object((context as FeedbackContext & { assignee?: { name: string } }).assignee).name;
    if (mapping.assignee) values[mapping.assignee] = { rich_text: typeof assignee === 'string' ? rich(assignee) : [] };
    if (mapping.screenshot) values[mapping.screenshot] = { files: screenshotId ? [{ name: 'Screenshot', type: 'file_upload', file_upload: { id: screenshotId } }] : [] };
    return values;
}
export function emptyNotionProperties(mapping: NotionMapping, schema?: NotionSchema): JsonObject {
    const result: JsonObject = {};
    for (const [key, originalType] of Object.entries(expectedTypes)) {
        const id = mapping[key as keyof typeof expectedTypes];
        if (!id || (schema && !schema[id])) continue;
        const type = schema?.[id]?.type ?? originalType;
        // A schema conversion can retain the previously copied value. Clear the current
        // writable representation, or keep cleanup blocked rather than claiming it was scrubbed.
        if (!['title', 'rich_text', 'files', 'select', 'date', 'url'].includes(type)) throw new NotionApiError(403, 'cleanup_property_type_changed');
        result[id] = type === 'title' ? { title: rich('Removed from uier') } : type === 'rich_text' ? { rich_text: [] }
            : type === 'files' ? { files: [] } : type === 'select' ? { select: null } : { [type]: null };
    }
    return result;
}
/** Normalize response property values to the same meaningful shape as write payloads. */
export function canonicalProperties(properties: JsonObject) {
    return Object.fromEntries(Object.entries(properties).map(([id, raw]) => {
        const property = object(raw); const type = typeof property.type === 'string' ? property.type : Object.keys(property)[0];
        if (type === 'title' || type === 'rich_text') return [id, { [type]: richText(property[type]) }];
        if (type === 'select' || type === 'status') return [id, { [type]: object(property[type]).name ?? null }];
        if (type === 'date') return [id, { date: object(property.date).start ?? null }];
        if (type === 'files') return [id, { files: array(property.files).map(file => ({ name: object(file).name, id: object(object(file).file_upload).id ?? null })) }];
        return [id, { [String(type)]: property[String(type)] ?? null }];
    }));
}
