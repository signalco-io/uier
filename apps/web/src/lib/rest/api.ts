import type { z } from 'zod';
import { getProject } from '../app/projects';
import { sha256Hex } from '../app/tokens';
import { orderedStatuses, statusForComment, type StatusWorkflow } from '../app/statusWorkflow';
import { loadStatusWorkflow } from '../app/statusWorkflows';
import { authorNames } from '../comments/authorNames';
import { commentPath } from '../comments/dto';
import { apiErrors, errorResponse, parseJsonBody } from '../comments/http';
import { listPage } from '../comments/listPage';
import { consume } from '../comments/rateLimits';
import { idempotencyKeySchema, textSchema } from '../comments/validation';
import type { DbComment } from '../db/schema';
import { authenticateRestToken, type McpCredential } from '../mcp/credentials';
import type { restScopes } from '../mcp/scopes';
import { commentPageCursor, formatCommentPageCursor } from '../repo/commentPage';
import { getCommentsStore } from '../repo/commentsStore';
import { memberActor, workspaceMemberAccess } from '../review/actor';
import { getProjectComment, listProjectCommentsPage, replyToProjectComment, setProjectCommentWorkflowStatus } from '../review/comments';
import { itemAuthorName } from '../review/dto';
import { apiPageLimit, apiRequestLimit, replyBody, statusBody, type feedbackDetail } from './contract';

async function projectAccess(credential: McpCredential, id: string) {
    if (!credential.projectIds.includes(id)) return null;
    const project = await getProject(credential.workspaceId, id);
    if (!project || project.id !== id) return null;
    const actor = await memberActor(project, credential.userId);
    if (actor?.kind !== 'member') return null;
    return { project, actor: { ...actor, agent: { credentialId: credential.id, name: credential.name, kind: 'credential' as const } } };
}

function summary(comment: DbComment, workflow: StatusWorkflow) {
    const first = comment.thread?.items?.[0];
    return {
        id: comment.id, path: commentPath(comment), statusId: statusForComment(workflow, comment).id,
        createdAt: comment.createdAt ?? null,
        excerpt: !first?.deletedAt && typeof first?.text === 'string' ? first.text.slice(0, 200) : null
    };
}

async function detail(comment: DbComment, workflow: StatusWorkflow): Promise<z.output<typeof feedbackDetail>> {
    const names = await authorNames([comment]);
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const messages = items.filter(item => item?.id != null).map(item => ({
        id: String(item.id),
        createdAt: item.createdAt ?? null,
        deleted: Boolean(item.deletedAt),
        author: item.deletedAt ? null : itemAuthorName(item, names),
        text: item.deletedAt ? null : item.text ?? ''
    }));
    return { ...summary(comment, workflow), messages };
}

function restRoute<P>(scope: typeof restScopes[number], run: (request: Request, params: P, token: McpCredential) => Promise<unknown>) {
    return async (request: Request, context: { params: Promise<P> }) => {
        // Access request-time data outside the API error boundary so Next can defer prerendering.
        const authorization = request.headers.get('authorization');
        let response: Response;
        try {
            const token = await authenticateRestToken(authorization);
            await consume(getCommentsStore(), `rest:${token.id}`, { key: 'requests', windowSeconds: 60, limit: apiRequestLimit,
                reason: 'too_fast', message: 'REST API request limit reached.' });
            if (!token.scopes.includes(scope)) throw apiErrors.forbidden(`This operation requires ${scope}.`);
            response = Response.json(await run(request, await context.params, token));
        } catch (error) {
            response = errorResponse(error);
            if (response.status === 401) response.headers.set('WWW-Authenticate', 'Bearer realm="uier REST API"');
        }
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    };
}

export const listProjects = restRoute('feedback:read', async (_request, _params, token) => {
    const member = await workspaceMemberAccess(token.workspaceId, token.userId);
    if (!member) return { items: [] };
    const projects = await Promise.all(token.projectIds.map(id => getProject(token.workspaceId, id)));
    return { items: projects.flatMap(project => project && member.canAccess(project) ? [{ id: project.id, name: project.name }] : []) };
});

type ProjectParams = { projectId: string };
type ThreadParams = ProjectParams & { feedbackId: string };

async function requireProject(token: McpCredential, id: string) {
    const access = await projectAccess(token, id);
    if (!access) throw apiErrors.notFound('Project not found.');
    return access;
}

export const listStatuses = restRoute<ProjectParams>('feedback:read', async (_request, { projectId }, token) => {
    const { project } = await requireProject(token, projectId);
    return { items: orderedStatuses(await loadStatusWorkflow(project)).map(({ id, label, category, description }) => ({ id, label, category, description })) };
});

export const listFeedback = restRoute<ProjectParams>('feedback:read', async (request, { projectId }, token) => {
    const { project, actor } = await requireProject(token, projectId);
    const params = new URL(request.url).searchParams;
    if (!params.has('limit')) params.set('limit', '25');
    const page = listPage(params)!;
    if (page.limit > apiPageLimit) throw apiErrors.invalidRequest(`Maximum page size is ${apiPageLimit}.`);
    const [{ comments, stored }, workflow] = await Promise.all([
        listProjectCommentsPage(project, actor, { ...page, limit: page.limit + 1 }), loadStatusWorkflow(project)
    ]);
    const lookahead = stored[page.limit];
    const last = lookahead && stored[page.limit - 1];
    return {
        items: comments.filter(comment => comment.id !== lookahead?.id).map(comment => summary(comment, workflow)),
        next: last ? formatCommentPageCursor(commentPageCursor(last)) : null
    };
});

/** Resolve visibility before processing a write receipt. The mutation still checks access on each retry. */
async function requireWebsiteFeedback(token: McpCredential, projectId: string, feedbackId: string) {
    const access = await requireProject(token, projectId);
    const comment = await getProjectComment(access.project, access.actor, feedbackId);
    if (!comment) throw apiErrors.notFound();
    return { ...access, comment };
}

export const getFeedback = restRoute<ThreadParams>('feedback:read', async (_request, { projectId, feedbackId }, token) => {
    const { project, comment } = await requireWebsiteFeedback(token, projectId, feedbackId);
    return detail(comment, await loadStatusWorkflow(project));
});

function retryKey(request: Request, credential: McpCredential) {
    const key = idempotencyKeySchema.safeParse(request.headers.get('Idempotency-Key'));
    if (!key.success) throw apiErrors.invalidRequest('Supply an Idempotency-Key of 16 to 128 letters, digits, underscores or hyphens.');
    return sha256Hex(`rest:${credential.id}:${key.data}`);
}

export const reply = restRoute<ThreadParams>('feedback:reply', async (request, { projectId, feedbackId }, token) => {
    const { project, actor } = await requireWebsiteFeedback(token, projectId, feedbackId);
    const key = retryKey(request, token);
    const { text } = await parseJsonBody(request, replyBody.extend({ text: textSchema }), 16_384);
    const comment = await replyToProjectComment(request, project, actor, feedbackId, { text, idempotencyKey: key });
    return detail(comment, await loadStatusWorkflow(project));
});

export const updateStatus = restRoute<ThreadParams>('feedback:status', async (request, { projectId, feedbackId }, token) => {
    const { project, actor } = await requireWebsiteFeedback(token, projectId, feedbackId);
    const key = retryKey(request, token);
    const { statusId } = await parseJsonBody(request, statusBody, 16_384);
    const comment = await setProjectCommentWorkflowStatus(project, actor, feedbackId, statusId, key);
    return detail(comment, await loadStatusWorkflow(project));
});
