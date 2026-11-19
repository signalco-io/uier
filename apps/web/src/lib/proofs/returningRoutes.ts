import { z } from 'zod';
import { afterResponse } from '../afterResponse';
import { configuredAppBaseUrl } from '../app/deployment';
import { parseJsonBody } from '../comments/http';
import { rateLimitIpBucket } from '../comments/rateLimits';
import { openProofReview, prepareProofRecovery, proofFollowState, sendProofRecovery, setProofFollow } from './returningReview';
import { proofThreadsHandler } from './threadRoutes';
import type { ProofThreadRoute } from './threadAccess';

const baseUrl = async () => configuredAppBaseUrl() ?? await (await import('../app/request')).appBaseUrl();

const followInput = z.object({ following: z.boolean(), email: z.string().max(254).optional() }).strict();
const returningInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('open'), token: z.string().min(1).max(2048) }).strict(),
    z.object({ action: z.literal('recover'), email: z.string().max(254) }).strict()
]);

export const proofFollowRoute = proofThreadsHandler(async (request, route: ProofThreadRoute & { threadId: string }) => {
    if (request.method === 'GET') return Response.json(await proofFollowState(request, route));
    const { following, email } = await parseJsonBody(request, followInput, 4_096);
    return Response.json(await setProofFollow(request, route, following, email, await baseUrl(), rateLimitIpBucket(request)));
});

export const proofReturningRoute = proofThreadsHandler(async (request, route: ProofThreadRoute) => {
    const input = await parseJsonBody(request, returningInput, 4_096);
    if (input.action === 'recover') {
        const address = await prepareProofRecovery(input.email, rateLimitIpBucket(request));
        const base = await baseUrl();
        const send = () => sendProofRecovery(route, address, base);
        if (!afterResponse(send)) await send();
        return new Response(null, { status: 204 });
    }
    const { href, cookie } = await openProofReview(route, input.token);
    return Response.json({ href }, { headers: { 'Set-Cookie': cookie } });
});
