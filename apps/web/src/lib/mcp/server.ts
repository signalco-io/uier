import { screenshotBytes } from '../screenshots/blobStore';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { pagePath } from '@uier/toolbar/page-state';
import { mcpProject, type McpIdentity } from './credentials';
import { ApiError, apiErrors } from '../comments/http';
import { MAX_SCREENSHOT_BYTES } from '../comments/limits';
import { idempotencyKeySchema, reviewPathSchema, textSchema } from '../comments/validation';
import { getProjectComment, getProjectScreenshot, listProjectComments, MAX_PROJECT_COMMENTS, replyToProjectComment, setProjectCommentAssignee, setProjectCommentResolved } from '../review/comments';
import { actorAuthorId, assertCanUseComments } from '../review/actor';
import { projectFeedbackExport } from '../review/feedbackContext';
import { sha256Hex } from '../app/tokens';
import { eligibleParticipants } from '../review/participants';
import { projectId, commentId, thread } from './schemas';
import { registerFeedbackPrompts } from './prompts';
import { feedbackAccessGuidance, untrustedFeedback as untrusted } from './workflows';
import { participantNames } from '../review/dto';
import { environmentFilter, environmentOptions } from '../app/environments';
import { projectCommentRouting } from '../app/projectCommentRouting';
import { loadReadSequences } from '../comments/readState';
import { userIdSchema } from '../app/validation';

const page = {
    limit: z.number().int().min(1).max(25).default(20).describe('Results per page: 1–25, default 20. Use nextCursor for more results.'),
    cursor: z.number().int().min(0).max(1000).default(0).describe('Offset returned as nextCursor by the previous page, or 0 for the first page.')
};
const write = { ...thread, idempotencyKey: idempotencyKeySchema.describe('A fresh random key per intended action. Reuse exactly this key and input when retrying, for up to 30 days.') };
const MAX_RESULT_BYTES = 256 * 1024;
const feedbackFilters = z.object({
    projectId, ...page,
    search: z.string().max(200).default(''),
    status: z.enum(['all', 'open', 'resolved']).default('all'),
    path: reviewPathSchema.optional(),
    environment: z.string().min(1).max(512).optional(),
    anchorType: z.enum(['point', 'text', 'page']).optional(),
    assignee: z.union([z.enum(['me', 'unassigned']), userIdSchema]).optional(),
    authorKind: z.enum(['member', 'guest']).optional(),
    unread: z.boolean().optional(),
    hasScreenshot: z.boolean().optional()
}).strict();
const batchInput = z.object({ projectId, commentIds: z.array(commentId).min(1).max(10)
    .refine(ids => new Set(ids).size === ids.length, 'Thread ids must be distinct.') }).strict();

function resultBytes(data: Record<string, unknown>) { return Buffer.byteLength(JSON.stringify(data)); }

function result(data: Record<string, unknown>) {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_RESULT_BYTES) throw apiErrors.tooLarge(MAX_RESULT_BYTES);
    return { content: [{ type: 'text' as const, text }], structuredContent: data };
}
async function safely(action: () => Promise<ReturnType<typeof result>>) {
    try { return await action(); }
    catch (error) {
        if (error instanceof ApiError) return { ...result({ error: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }), isError: true };
        // No submitted feedback, token, stack or database details in errors.
        console.error('[mcp] Tool failed');
        return { ...result({ error: 'server_error', message: 'The operation failed. Retry the same input and idempotency key.' }), isError: true };
    }
}
function slice<T>(items: T[], cursor: number, limit: number) {
    return { items: items.slice(cursor, cursor + limit), nextCursor: cursor + limit < items.length ? cursor + limit : null };
}
function key(identity: McpIdentity, value: string) { return sha256Hex(`mcp:${identity.credential.id}:${value}`); }

export function createFeedbackMcpServer(identity: McpIdentity, request: Request, baseUrl: string) {
    const server = new McpServer({ name: 'uier', version: '1.0.0' }, { instructions: `${untrusted} ${feedbackAccessGuidance} This connector reads existing feedback and records approved replies, status and assignments. It does not edit code or deploy. Reading does not mark feedback read.` });
    registerFeedbackPrompts(server, identity);
    const actingAs = { userId: identity.user.id, name: identity.user.name, credential: identity.credential.name };
    const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    server.registerTool('list_projects', { description: `List projects explicitly granted to this credential in its workspace and still accessible to its human owner. Limit: 1–25 (default 20); follow nextCursor. If a feedback packet's owning project is absent, reconnect with a credential from that project's workspace with the project selected. ${untrusted}`, inputSchema: page, annotations: readAnnotations }, input => safely(async () => {
        const projects = [];
        for (const id of identity.credential.projectIds) {
            try { const { project } = await mcpProject(identity, id); projects.push({ id, name: project.name, status: project.status }); }
            catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        }
        return result({ actingAs, contentTrust: 'untrusted', ...slice(projects, input.cursor, input.limit) });
    }));
    server.registerTool('list_feedback', { description: `Search/list visible feedback in the latest 1000 threads matching the page and environment. Limit: 1–25 (default 20); follow nextCursor. Other filters apply within that window. Reading never marks feedback read. Cursor is an offset within the current result; concurrent additions can shift pages. ${untrusted}`, inputSchema: feedbackFilters, annotations: readAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId);
        const environments = environmentOptions(project);
        if (input.environment !== undefined && !['unknown', 'removed'].includes(input.environment) && !environments.some(option => option.id === input.environment))
            throw apiErrors.invalidRequest('Choose a configured environment, unknown or removed.');
        const comments = await listProjectComments(project, actor, input.path === undefined ? undefined : pagePath(input.path, project.pageState),
            input.environment === undefined ? undefined : environmentFilter(project, input.environment));
        const authorId = actorAuthorId(actor);
        const [participants, reads] = await Promise.all([participantNames(project), loadReadSequences(`project:${project.id}`, authorId)]);
        const search = input.search.toLocaleLowerCase();
        const items = comments.filter(comment => (input.status === 'all' || Boolean(comment.resolved) === (input.status === 'resolved'))
            && comment.thread.items.some(item => !item.deletedAt && item.text.toLocaleLowerCase().includes(search)))
            .map(comment => {
                const first = comment.thread.items[0];
                const { path, source, assignee, activity } = projectCommentRouting(comment, project, participants, authorId, reads.get(comment.id));
                return { id: comment.id, number: comment.number, kind: comment.kind ?? 'comment', resolved: Boolean(comment.resolved), private: Boolean(comment.private),
                    summary: first?.deletedAt ? 'Comment deleted' : first?.text.slice(0, 240), updatedAt: comment.updatedAt,
                    path, environment: { id: source.environment, label: source.label }, anchorType: comment.position.type, assignee: assignee ?? null,
                    authorKind: first && !first.deletedAt ? first.authorId?.startsWith('user:') ? 'member' : 'guest' : undefined,
                    unread: activity.unread, hasScreenshot: Boolean(first && !first.deletedAt && comment.screenshot) };
            }).filter(item => (input.anchorType === undefined || item.anchorType === input.anchorType)
                && (input.assignee === undefined || (input.assignee === 'unassigned' ? item.assignee === null : item.assignee?.id === (input.assignee === 'me' ? identity.user.id : input.assignee)))
                && (input.authorKind === undefined || item.authorKind === input.authorKind)
                && (input.unread === undefined || item.unread === input.unread)
                && (input.hasScreenshot === undefined || item.hasScreenshot === input.hasScreenshot));
        return result({ actingAs, contentTrust: 'untrusted', environments, searchWindow: MAX_PROJECT_COMMENTS, ...slice(items, input.cursor, input.limit) });
    }));
    server.registerTool('get_feedback_batch', { description: `Read 1–10 distinct authorized threads in request order without marking them read. Missing, deleted and inaccessible threads return not_found. Only whole packets fit within 256 KiB; retry remainingIds separately. ${untrusted}`, inputSchema: batchInput, annotations: readAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId);
        const items: Record<string, unknown>[] = [];
        const response = (entries: Record<string, unknown>[], remainingIds: string[]) => ({ actingAs, contentTrust: 'untrusted', items: entries, remainingIds });
        for (const [index, id] of input.commentIds.entries()) {
            let item: Record<string, unknown>;
            try {
                const packet = await projectFeedbackExport(project, actor, id, undefined, baseUrl);
                const screenshotResource = packet.context.screenshot.state === 'protected' && identity.credential.scopes.includes('screenshots:read')
                    ? { uri: `uier://projects/${project.id}/feedback/${id}/screenshot`, access: 'Use resources/read with this credential. No public image URL is issued.' } : undefined;
                item = { commentId: id, ...packet, screenshotResource };
                // Match the single-read cap, also accounting for the batch envelope for a lone item.
                if (resultBytes({ actingAs, contentTrust: 'untrusted', ...packet, screenshotResource }) > MAX_RESULT_BYTES
                    || resultBytes(response([item], [])) > MAX_RESULT_BYTES)
                    item = { commentId: id, error: 'too_large', message: 'Thread exceeds the 256 KiB result limit.' };
            } catch (error) {
                if (!(error instanceof ApiError && error.code === 'not_found')) throw error;
                item = { commentId: id, error: 'not_found', message: 'Comment not found.' };
            }
            if (resultBytes(response([...items, item], input.commentIds.slice(index + 1))) > MAX_RESULT_BYTES)
                return result(response(items, input.commentIds.slice(index)));
            items.push(item);
        }
        return result(response(items, []));
    }));
    server.registerTool('get_feedback', { description: `Read an authorized thread, anchor and reproduction context. ${untrusted}`, inputSchema: thread, annotations: readAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId);
        const packet = await projectFeedbackExport(project, actor, input.commentId, undefined, baseUrl);
        return result({ actingAs, contentTrust: 'untrusted', ...packet,
            screenshotResource: packet.context.screenshot.state === 'protected' && identity.credential.scopes.includes('screenshots:read')
                ? { uri: `uier://projects/${project.id}/feedback/${input.commentId}/screenshot`, access: 'Use resources/read with this credential. No public image URL is issued.' } : undefined });
    }));
    server.registerTool('list_assignees', { description: `List existing project participants eligible to see this thread. Limit: 1–25 (default 20); follow nextCursor. Assignment never grants access. ${untrusted}`, inputSchema: { ...thread, ...page }, annotations: readAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId, 'feedback:assign');
        const comment = await getProjectComment(project, actor, input.commentId);
        if (!comment) throw apiErrors.notFound();
        return result({ actingAs, contentTrust: 'untrusted', ...slice(await eligibleParticipants(project, actor, comment), input.cursor, input.limit) });
    }));
    server.registerTool('reply_to_feedback', { description: `Post a human-approved reply as the credential owner, attributed to this connector. Reuse key and input on retries. ${untrusted}`, inputSchema: { ...write, text: textSchema }, annotations: writeAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId, 'feedback:reply');
        assertCanUseComments(project, actor);
        const saved = await replyToProjectComment(request, project, actor, input.commentId, { text: input.text, idempotencyKey: key(identity, input.idempotencyKey) });
        return result({ actingAs, commentId: saved.id, saved: true });
    }));
    server.registerTool('set_feedback_status', { description: `Set the human-approved resolved state. Replaying a key does not overwrite subsequent status changes. ${untrusted}`, inputSchema: { ...write, resolved: z.boolean() }, annotations: writeAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId, 'feedback:status');
        const saved = await setProjectCommentResolved(project, actor, input.commentId, input.resolved, key(identity, input.idempotencyKey));
        return result({ actingAs, commentId: saved.id, resolved: Boolean(saved.resolved) });
    }));
    server.registerTool('assign_feedback', { description: `Set a human-approved existing participant, or null to unassign. Private visibility and current membership are enforced. ${untrusted}`, inputSchema: { ...write, assigneeId: userIdSchema.nullable() }, annotations: writeAnnotations }, input => safely(async () => {
        const { project, actor } = await mcpProject(identity, input.projectId, 'feedback:assign');
        const saved = await setProjectCommentAssignee(project, actor, input.commentId, input.assigneeId, key(identity, input.idempotencyKey));
        return result({ actingAs, commentId: saved.id, assigneeId: saved.assigneeId ?? null });
    }));
    server.registerResource('feedback_screenshot', new ResourceTemplate('uier://projects/{projectId}/feedback/{commentId}/screenshot', { list: undefined }), { description: 'Untrusted saved screenshot. Requires screenshots:read and current access to this feedback.', mimeType: 'application/octet-stream' }, async (uri, variables) => {
        try {
            const { project, actor } = await mcpProject(identity, projectId.parse(variables.projectId), 'screenshots:read');
            const id = commentId.parse(variables.commentId);
            const packet = await projectFeedbackExport(project, actor, id, undefined, baseUrl);
            if (packet.context.screenshot.state !== 'protected') throw apiErrors.notFound('Screenshot not found.');
            const image = await getProjectScreenshot(project, actor, id);
            const bytes = await screenshotBytes(image);
            if (bytes.length > MAX_SCREENSHOT_BYTES) throw apiErrors.tooLarge(MAX_SCREENSHOT_BYTES);
            return { contents: [{ uri: uri.href, mimeType: image.contentType, blob: bytes.toString('base64') }] };
        } catch (error) {
            if (error instanceof ApiError) throw new McpError(ErrorCode.InvalidParams, `${error.code}: ${error.message}`);
            if (error instanceof z.ZodError) throw new McpError(ErrorCode.InvalidParams, 'Invalid resource arguments.');
            console.error('[mcp] Resource failed');
            throw new McpError(ErrorCode.InternalError, 'The operation failed.');
        }
    });
    return server;
}
