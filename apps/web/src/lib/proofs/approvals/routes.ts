import { assertAppOrigin } from '../../app/avatarUpload';
import { ApiError, apiErrors, errorResponse, parseJsonBody } from '../../comments/http';
import { configuredAppBaseUrl } from '../../app/deployment';
import { proofProject } from '../access';
import { proofNotFound } from '../store';
import { proofReferenceId } from '../threadSchema';
import { exportApprovalReview } from './export';
import { deliverApprovalAfterResponse } from './mail';
import { approvalConfigure, approvalExchangeInput, approvalRecovery, approvalStart, approvalSubmit } from './schema';
import { approvalDashboard, approvalOptions, configureApproval, exchangeApprovalLink, readApprovalReview, requestApprovalLink, startApproval, submitApproval } from './service';

type ApprovalRoute = { projectId: string };
type AssetApprovalRoute = ApprovalRoute & { assetId: string };

function approvalHandler<P extends ApprovalRoute>(handle: (request: Request, route: P) => Promise<Response>) {
    return async (request: Request, { params }: { params: Promise<P> }) => {
        let response: Response;
        try {
            const site = request.headers.get('sec-fetch-site');
            if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
            if (request.method !== 'GET') assertAppOrigin(request);
            response = await handle(request, await params);
        } catch (error) {
            if (!(error instanceof ApiError)) console.error('[proof approvals] Request failed.');
            response = errorResponse(error instanceof ApiError ? error : new ApiError(500, 'server_error', 'The request could not be completed.'));
        }
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Cookie');
        response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        return response;
    };
}

function optionalId(query: URLSearchParams, name: string) {
    const raw = query.get(name);
    if (raw === null) return undefined;
    const parsed = proofReferenceId.safeParse(raw);
    if (!parsed.success) throw proofNotFound();
    return parsed.data;
}

export const projectApprovalRoute = approvalHandler(async (request, { projectId }: ApprovalRoute) => {
    if (request.method === 'GET') {
        return Response.json(await approvalDashboard(request, projectId, optionalId(new URL(request.url).searchParams, 'collection')));
    }
    const { token } = await parseJsonBody(request, approvalExchangeInput, 4_096);
    const { cookies, ...target } = await exchangeApprovalLink(request, projectId, token);
    const response = Response.json(target);
    for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
    return response;
});

export const assetApprovalRoute = approvalHandler(async (request, route: AssetApprovalRoute) => {
    if (!proofReferenceId.safeParse(route.assetId).success) throw proofNotFound();
    const query = new URL(request.url).searchParams;
    const mode = query.get('mode');
    if (request.method === 'GET') {
        const version = optionalId(query, 'version');
        if (mode === 'export') return exportApprovalReview(request, route, version);
        if (mode === 'options') return Response.json(await approvalOptions(request, route, version));
        return Response.json(await readApprovalReview(request, route, version));
    }
    if (request.method === 'POST' && mode === 'decision') {
        const input = await parseJsonBody(request, approvalSubmit, 8_192);
        return Response.json(await submitApproval(request, route, input));
    }
    if (request.method === 'POST' && mode === 'recover') {
        const input = await parseJsonBody(request, approvalRecovery, 4_096);
        const job = await requestApprovalLink(request, route, input.versionId, input.email);
        if (job) deliverApprovalAfterResponse(job.projectId, input.versionId);
        return new Response(null, { status: 204 });
    }
    if (mode !== null) throw proofNotFound();
    const input = await parseJsonBody(request, request.method === 'PATCH' ? approvalConfigure : approvalStart, 16_384);
    const review = 'state' in input ? await configureApproval(request, route, input) : await startApproval(request, route, input);
    if (review.round?.state === 'open' && configuredAppBaseUrl()) deliverApprovalAfterResponse((await proofProject(route.projectId)).id, input.versionId);
    return Response.json(review);
});
