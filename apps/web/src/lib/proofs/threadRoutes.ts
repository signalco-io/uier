import { z } from 'zod';
import { feedbackStatusTargets } from '@uier/toolbar/verification';
import { assertAppOrigin } from '../app/avatarUpload';
import { configuredAppBaseUrl } from '../app/deployment';
import { loadStatusWorkflow } from '../app/statusWorkflows';
import { defaultStatusWorkflow, orderedStatuses, statusForComment } from '../app/statusWorkflow';
import { feedbackExport } from '../comments/feedbackContext';
import { apiErrors, errorResponse, parseJsonBody } from '../comments/http';
import { listPage } from '../comments/listPage';
import { withinListResponseSize } from '../comments/dto';
import { loadReadSequences, markThreadRead } from '../comments/readState';
import { idempotencyKeySchema, isValidId } from '../comments/validation';
import type { DbComment } from '../db/schema';
import { actorAuthorId } from '../review/actor';
import { assigneeIdsSchema } from '../review/assignments';
import { commentRevision } from '../review/commentRevision';
import { canSeeComment, changeComment, commentVisibilityFilter, createProjectComment, getProjectComment, projectPartition, replyToProjectComment, setProjectCommentArchived, setProjectCommentAssignees, setProjectCommentPrivate, setProjectCommentStatus, setProjectCommentWorkflowStatus } from '../review/comments';
import { authorNames, participantNames, toReviewCommentDto } from '../review/dto';
import { changeFixVerification, verificationPermissions } from '../review/fixVerification';
import { fixVerificationSchema } from '../review/fixVerificationSchema';
import { eligibleParticipants } from '../review/participants';
import { commentPageCursor, formatCommentPageCursor } from '../repo/commentPage';
import { getCommentsStore } from '../repo/commentsStore';
import type { ProofThreadFilter } from '../repo/proofThreadFilter';
import { proofApiPath } from './model';
import { authorizeProofThread, guestCanReviewProof, type ProofThreadRoute } from './threadAccess';
import { proofThreadLocation, proofThreadPath, type ProofPendingPage, type ProofThread, type ProofThreadPage } from './threadModel';
import { assertProofAnchor, proofCreateThreadSchema, proofLocationSchema, proofMessageSchema, proofReferenceId } from './threadSchema';
import { proofNotFound, proofStore } from './store';

type ThreadRoute = ProofThreadRoute & { threadId: string };
type ThreadAuth = Awaited<ReturnType<typeof authorizeProofThread>>;
const pageSize = 15;
const inputLimit = 64 * 1024;

export function proofThreadsHandler<P extends ProofThreadRoute>(run: (request: Request, params: P) => Promise<Response>) {
    return async (request: Request, route: { params: Promise<P> }) => {
        let response: Response;
        try {
            const site = request.headers.get('sec-fetch-site');
            if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
            if (request.method !== 'GET' && request.method !== 'HEAD') assertAppOrigin(request);
            const params = await route.params;
            if (!proofReferenceId.safeParse(params.assetId).success) throw proofNotFound();
            if ('threadId' in params && (typeof params.threadId !== 'string' || !isValidId(params.threadId))) throw proofNotFound();
            response = await run(request, params);
        } catch (error) { response = errorResponse(error); }
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Cookie');
        return response;
    };
}

function versionParam(request: Request) {
    const raw = new URL(request.url).searchParams.get('version');
    if (raw === null) return undefined;
    const checked = proofReferenceId.safeParse(raw);
    if (!checked.success) throw proofNotFound();
    return checked.data;
}

async function projection(auth: ThreadAuth, comments: DbComment[], detail = false) {
    const { project, actor, permissions, version, asset } = auth;
    const domain = projectPartition(project.id);
    const [names, participants, workflow, reads] = await Promise.all([
        authorNames(comments), participantNames(project),
        actor.kind === 'member' ? loadStatusWorkflow(project) : { ...defaultStatusWorkflow, verificationEnabled: project.verificationEnabled === true },
        loadReadSequences(domain, actorAuthorId(actor))
    ]);
    const visible = comments.filter(comment => canSeeComment(comment, actor));
    const threads = await Promise.all(visible.map(async comment => {
        if (!comment.assetTarget) throw proofNotFound();
        const { authorShareId, ...target } = comment.assetTarget;
        const dto = toReviewCommentDto(comment, actor, names, [], reads.get(comment.id), participants, project);
        if (!dto) throw proofNotFound();
        const verification = dto.verification;
        const evidence = verification ? comment.verification?.evidence : undefined;
        const verificationActions = verificationPermissions(comment, project, actor, participants);
        if (detail && verificationActions.request && verificationActions.defaultReviewer && authorShareId)
            verificationActions.defaultReviewer = await guestCanReviewProof(project, comment);
        if (actor.kind === 'guest' && verificationActions.respond && authorShareId !== actor.proofThread?.shareId)
            verificationActions.respond = false;
        const returning = actor.proofThread?.returning;
        const proof: ProofThread = {
            id: dto.id, number: dto.number,
            thread: returning ? { items: dto.thread.items.map(item => 'deleted' in item ? item : { ...item, canDelete: false, canEdit: false }) } : dto.thread,
            resolved: dto.resolved, inProgress: dto.inProgress, archivedAt: dto.archivedAt, private: dto.private,
            permissions: { ...dto.permissions, ...(returning ? { edit: false, delete: false } : {}), resolve: !returning && permissions.comment && dto.permissions.resolve, assign: permissions.comment && dto.permissions.assign,
                makePrivate: permissions.comment && actor.kind === 'member' && actor.isAdmin },
            assignees: dto.assignees, activity: dto.activity, target,
            location: proofThreadLocation(target, evidence, version?.id),
            href: proofThreadPath(project.publicId ?? project.id, target.assetId, target.source.versionId, comment.id),
            revision: commentRevision(comment), statusId: statusForComment(workflow, comment).id, currentVersionId: asset?.currentVersionId ?? null,
            verificationEnabled: dto.verificationEnabled === true,
            ...(actor.kind === 'guest' && permissions.comment && comment.authorId === actor.visitorId && authorShareId === actor.proofThread?.shareId
                && !comment.thread.items[0]?.deletedAt ? { canFollow: true } : {}),
            verificationPermissions: permissions.comment ? verificationActions
                : { request: false, respond: false, cancel: false, override: false, defaultReviewer: false },
            ...(verification ? { verification: { ...verification, ...(evidence ? { evidence } : {}) } } : {})
        };
        if (detail && evidence) {
            const proofs = proofStore(project.id);
            const link = async (side: 'before' | 'after') => {
                const location = evidence[side];
                const saved = (await proofs.version(location.versionId))?.doc;
                if (!saved || saved.status !== 'published' || saved.assetId !== target.assetId) return undefined;
                const surfaceId = 'surfaceId' in location.anchor ? location.anchor.surfaceId : undefined;
                const artifact = saved.manifest?.surfaces.find(surface => surface.id === surfaceId)?.artifactId;
                const previewUrl = artifact && saved.artifacts.some(item => item.id === artifact)
                    ? `${proofApiPath(project.publicId ?? project.id)}/assets/${encodeURIComponent(target.assetId)}/versions/${encodeURIComponent(saved.id)}/media/${encodeURIComponent(artifact)}` : undefined;
                return { number: saved.number, href: proofThreadPath(project.publicId ?? project.id, target.assetId, saved.id, comment.id), previewUrl };
            };
            const [before, after] = await Promise.all([link('before'), link('after')]);
            if (before && after) proof.evidenceLinks = { before, after };
        }
        if (detail && actor.kind === 'member' && permissions.comment)
            proof.participants = await eligibleParticipants(project, actor, comment);
        return { proof, dto };
    }));
    return { threads, workflow };
}

async function detailResponse(auth: ThreadAuth, comment: DbComment, status = 200) {
    const thread = (await projection(auth, [comment], true)).threads[0]?.proof;
    if (!thread) throw proofNotFound();
    return Response.json({ thread }, { status });
}

async function loadThread(auth: ThreadAuth, threadId: string) {
    const comment = await getProjectComment(auth.project, auth.actor, threadId);
    if (!comment) throw proofNotFound();
    return comment;
}

function pageFrom(request: Request) {
    const query = new URL(request.url).searchParams;
    if (!query.has('limit')) query.set('limit', String(pageSize));
    const page = listPage(query)!;
    return { ...page, limit: Math.min(page.limit, 30) };
}

async function threadPage(request: Request, auth: ThreadAuth, proof: ProofThreadFilter, pending: boolean) {
    const domain = projectPartition(auth.project.id);
    const store = getCommentsStore();
    const page = pageFrom(request);
    const [stored, count] = await Promise.all([
        store.listPage(domain, { ...page, limit: page.limit + 1, proof }),
        pending ? store.countProofThreads(domain, proof) : Promise.resolve(0)
    ]);
    const { threads, workflow } = await projection(auth, stored.slice(0, page.limit));
    const fitting = withinListResponseSize(threads.map(({ proof }) => proof)).length;
    const last = fitting < threads.length ? stored[Math.max(0, fitting - 1)] : stored.length > page.limit ? stored[page.limit - 1] : undefined;
    return { threads: threads.slice(0, fitting).map(({ proof }) => proof),
        next: last ? formatCommentPageCursor(commentPageCursor(last)) : null,
        count, statuses: orderedStatuses(workflow) };
}

export const listProofThreads = proofThreadsHandler(async (request, route: ProofThreadRoute) => {
    const auth = await authorizeProofThread(request, route, versionParam(request));
    const returning = auth.actor.proofThread?.returning;
    const proof = { asset: route.assetId, versionId: auth.version?.id, visibility: commentVisibilityFilter(projectPartition(auth.project.id), auth.actor),
        ...(returning ? { authorId: actorAuthorId(auth.actor), authorShareId: auth.actor.proofThread?.shareId } : {}) };
    const { threads, next, statuses } = await threadPage(request, auth, proof, false);
    return Response.json({ threads, next, statuses, canComment: auth.permissions.comment && !returning, guest: auth.actor.kind === 'guest',
        returning, canMakePrivate: auth.permissions.comment && auth.actor.kind === 'member' && auth.actor.isAdmin } satisfies ProofThreadPage);
});

export const listProofVerification = proofThreadsHandler(async (request, route: ProofThreadRoute) => {
    const auth = await authorizeProofThread(request, route, versionParam(request));
    if (!auth.permissions.comment || auth.project.verificationEnabled !== true || !auth.version)
        return Response.json({ threads: [], next: null, count: 0 } satisfies ProofPendingPage);
    const domain = projectPartition(auth.project.id);
    const scope = new URL(request.url).searchParams.get('scope');
    const proof = { asset: route.assetId, versionId: scope === 'asset' ? undefined : auth.version.id, reviewerId: actorAuthorId(auth.actor)!, visibility: commentVisibilityFilter(domain, auth.actor),
        ...(auth.actor.kind === 'guest' ? { authorId: auth.actor.visitorId, authorShareId: auth.actor.proofThread?.shareId } : {}) };
    const { threads, next, count } = await threadPage(request, auth, proof, true);
    return Response.json({ threads, next, count } satisfies ProofPendingPage);
});

export const createProofThread = proofThreadsHandler(async (request, route: ProofThreadRoute) => {
    const input = await parseJsonBody(request, proofCreateThreadSchema, inputLimit);
    const auth = await authorizeProofThread(request, route, input.location.versionId, true);
    assertProofAnchor(input.location.anchor, auth.version?.manifest);
    const format = auth.version?.manifest?.format;
    if (input.suggestion && (input.location.anchor.kind !== 'text' || (format !== 'email' && format !== 'pdf')))
        throw apiErrors.invalidRequest('Choose a location on this version.');
    if (auth.actor.kind === 'guest' && !input.authorName) throw apiErrors.invalidRequest('Enter your name.');
    const saved = await createProjectComment(request, auth.project, auth.actor, {
        path: `/proof/${encodeURIComponent(route.assetId)}`, position: { type: 'page' }, kind: 'comment',
        ...input, assetTarget: { assetId: route.assetId, source: input.location, ...(input.suggestion ? { suggestion: input.suggestion } : {}), authorShareId: auth.actor.proofThread?.shareId }
    });
    return detailResponse(auth, saved, 201);
});

export const getProofThread = proofThreadsHandler(async (request, route: ThreadRoute) => {
    const auth = await authorizeProofThread(request, route, versionParam(request));
    return detailResponse(auth, await loadThread(auth, route.threadId));
});

export const replyToProofThread = proofThreadsHandler(async (request, route: ThreadRoute) => {
    const input = await parseJsonBody(request, proofMessageSchema, inputLimit);
    const auth = await authorizeProofThread(request, route, versionParam(request), true);
    if (auth.actor.kind === 'guest' && !input.authorName) throw apiErrors.invalidRequest('Enter your name.');
    return detailResponse(auth, await replyToProjectComment(request, auth.project, auth.actor, route.threadId, input), 201);
});

export const verifyProofThread = proofThreadsHandler(async (request, route: ThreadRoute) => {
    const input = await parseJsonBody(request, fixVerificationSchema, inputLimit);
    const target = input.action === 'request' ? input.evidence?.after.versionId : input.targetVersionId;
    if (!target) throw apiErrors.invalidRequest('Choose a verification version.');
    const auth = await authorizeProofThread(request, route, target, true, true);
    return detailResponse(auth, await changeFixVerification(auth.project, auth.actor, route.threadId, input));
});

const changeSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('status'), statusId: z.string().min(1).max(100), idempotencyKey: idempotencyKeySchema }).strict(),
    z.object({ operation: z.literal('archive'), archived: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
    z.object({ operation: z.literal('assignment'), assigneeIds: assigneeIdsSchema, idempotencyKey: idempotencyKeySchema }).strict(),
    z.object({ operation: z.literal('private'), private: z.boolean() }).strict(),
    z.object({ operation: z.literal('read'), sequence: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
    z.object({ operation: z.literal('relocate'), location: proofLocationSchema, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
]);

export const changeProofThread = proofThreadsHandler(async (request, route: ThreadRoute) => {
    const input = await parseJsonBody(request, changeSchema, inputLimit);
    const { threadId } = route;
    const auth = await authorizeProofThread(request, route, input.operation === 'relocate' ? input.location.versionId : versionParam(request), input.operation !== 'read');
    const { project, actor, version } = auth;
    switch (input.operation) {
        case 'read': {
            const comment = await loadThread(auth, threadId);
            return Response.json({ activity: await markThreadRead(comment, actorAuthorId(actor)!, input.sequence) });
        }
        case 'status': {
            if (actor.kind === 'member')
                return detailResponse(auth, await setProjectCommentWorkflowStatus(project, actor, threadId, input.statusId, input.idempotencyKey));
            if (input.statusId === 'archive')
                return detailResponse(auth, await setProjectCommentArchived(project, actor, threadId, true, input.idempotencyKey));
            const status = z.enum(feedbackStatusTargets).safeParse(input.statusId);
            if (!status.success) throw apiErrors.invalidRequest('Choose Open, In progress or Done.');
            return detailResponse(auth, await setProjectCommentStatus(project, actor, threadId, status.data, input.idempotencyKey));
        }
        case 'archive':
            return detailResponse(auth, await setProjectCommentArchived(project, actor, threadId, input.archived, input.idempotencyKey));
        case 'assignment':
            return detailResponse(auth, await setProjectCommentAssignees(project, actor, threadId, input.assigneeIds, 'replace', input.idempotencyKey));
        case 'private':
            return detailResponse(auth, await setProjectCommentPrivate(project, actor, threadId, input.private));
        case 'relocate': {
            const saved = await changeComment(project, actor, threadId, () => actor.kind === 'member', comment => {
                const target = comment.assetTarget!;
                if (target.source.versionId === input.location.versionId) throw apiErrors.invalidRequest('The original location is retained.');
                assertProofAnchor(input.location.anchor, version?.manifest);
                const relocations = (target.relocations ?? []).filter(location => location.versionId !== input.location.versionId);
                const assetTarget = { ...target, relocations: [...relocations, input.location] };
                if (Buffer.byteLength(JSON.stringify(assetTarget)) > 256 * 1024)
                    throw apiErrors.invalidRequest('Choose a smaller location for this thread.');
                return { ...comment, assetTarget };
            }, undefined, { expected: null, revision: input.expectedRevision, value: () => null });
            return detailResponse(auth, saved);
        }
    }
});

export const exportProofThread = proofThreadsHandler(async (request, route: ThreadRoute) => {
    const auth = await authorizeProofThread(request, route, versionParam(request), false, false);
    const comment = await loadThread(auth, route.threadId);
    const { project } = auth;
    const bundle = (await projection(auth, [comment], true)).threads[0];
    if (!bundle) throw proofNotFound();
    const { proof, dto } = bundle;
    const baseUrl = configuredAppBaseUrl() ?? await (await import('../app/request')).appBaseUrl();
    const commentUrl = new URL(proof.href, baseUrl).toString();
    const member = auth.actor.kind === 'member';
    const exported = feedbackExport(dto, { projectId: member ? project.id : project.publicId, commentUrl, assignees: member ? dto.assignees : undefined });
    const revision = proof.location.versionId !== proof.target.source.versionId
        ? new URL(proofThreadPath(project.publicId ?? project.id, route.assetId, proof.location.versionId, comment.id), baseUrl).href : undefined;
    const evidenceLinks = proof.evidenceLinks && {
        before: new URL(proof.evidenceLinks.before.href, baseUrl).toString(),
        after: new URL(proof.evidenceLinks.after.href, baseUrl).toString()
    };
    const proofContext = { target: proof.target, verification: proof.verification, evidenceLinks };
    const links = [revision && `Review revision: ${revision}`, evidenceLinks && `Before: ${evidenceLinks.before}\nAfter: ${evidenceLinks.after}`].filter(Boolean);
    return Response.json({ ...exported, context: { ...exported.context, proof: proofContext,
        identity: { ...exported.context.identity, assetId: route.assetId },
        links: { ...exported.context.links, ...(revision ? { revision } : {}) } },
        markdown: [exported.markdown, ...links].join('\n\n') });
});
