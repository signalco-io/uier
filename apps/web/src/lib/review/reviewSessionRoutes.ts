import { z } from 'zod';
import { apiErrors, parseJsonBody } from '../comments/http';
import { idempotencyKeySchema } from '../comments/validation';
import type { ReviewApiContext } from './http';
import { discardReviewSession, editReviewSession, getReviewSession, listReviewSessions, resumeReviewSession, sendReviewSession, startReviewSession } from './reviewSessions';

export const reviewSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,72}$/);
const draft = { draftId: reviewSessionIdSchema };
const text = { title: z.string().trim().max(120).optional(), summary: z.string().trim().max(1_000).optional() };
const pageSchema = z.object({ before: reviewSessionIdSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const editSchema = z.object({ ...draft, ...text }).strict();
const submitSchema = z.object({ ...draft, ...text, revision: z.number().int().nonnegative().max(100), idempotencyKey: idempotencyKeySchema }).strict();
type Params = { projectId: string; id: string };

function reviewId({ id }: Params) {
    const parsed = reviewSessionIdSchema.safeParse(id);
    if (!parsed.success) throw apiErrors.notFound('Review session not found.');
    return parsed.data;
}

export async function listReviewSessionRoute({ project, actor, request }: ReviewApiContext) {
    const params = new URL(request.url).searchParams;
    const page = pageSchema.safeParse({ before: params.get('before') ?? undefined, limit: params.get('limit') ?? undefined });
    if (!page.success) throw apiErrors.invalidRequest('Invalid review session list page.');
    return Response.json(await listReviewSessions(project, actor, page.data));
}

export async function startReviewSessionRoute({ project, actor }: ReviewApiContext) {
    return Response.json(await startReviewSession(project, actor));
}

export async function getReviewSessionRoute({ project, actor }: ReviewApiContext, params: Params) {
    return Response.json(await getReviewSession(project, actor, reviewId(params)));
}

export async function editReviewSessionRoute({ request, project, actor }: ReviewApiContext, params: Params) {
    return Response.json(await editReviewSession(project, actor, reviewId(params), await parseJsonBody(request, editSchema)));
}

export async function submitReviewSessionRoute({ request, project, actor }: ReviewApiContext, params: Params) {
    return Response.json(await sendReviewSession(project, actor, reviewId(params), await parseJsonBody(request, submitSchema)));
}

export async function resumeReviewSessionRoute({ project, actor }: ReviewApiContext, params: Params) {
    return Response.json(await resumeReviewSession(project, actor, reviewId(params)));
}

export async function discardReviewSessionRoute({ request, project, actor }: ReviewApiContext, params: Params) {
    const { draftId } = await parseJsonBody(request, z.object(draft).strict());
    return Response.json(await discardReviewSession(project, actor, reviewId(params), draftId));
}
