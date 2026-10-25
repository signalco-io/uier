import { z } from 'zod';
import { projectOrigins } from '../app/projects';
import { signToken, verifyToken } from '../app/tokens';
import { assertNotBot } from '../comments/botProtection';
import { apiErrors, parseJsonBody } from '../comments/http';
import { actorAuthorId } from './actor';
import type { ReviewApiContext } from './http';

export const VERIFICATION_HEADER = 'X-Uier-Verification';
const ttlSeconds = 5 * 60;
type Verification = { projectId: string; origin: string; authorId: string };

/** BotID runs on uier's origin in the verification frame, with no third-party cookies. */
export async function createVerification({ request, project, actor, siteOrigin }: ReviewApiContext) {
    if (siteOrigin || request.headers.get('sec-fetch-site') === 'cross-site')
        throw apiErrors.forbidden();
    const { origin } = await parseJsonBody(request, z.object({ origin: z.string().max(512) }));
    const authorId = actorAuthorId(actor);
    if (!authorId || !projectOrigins(project).includes(origin))
        throw apiErrors.forbidden();
    await assertNotBot();
    return Response.json({
        token: signToken<Verification>('review-verification', { projectId: project.id, origin, authorId }, ttlSeconds),
        expiresAt: Date.now() + ttlSeconds * 1000
    });
}

/** Every write needs BotID directly, or its short-lived, origin/project/reviewer-bound proof. */
export async function assertVerifiedWrite({ request, project, actor, siteOrigin }: ReviewApiContext) {
    if (!siteOrigin) {
        await assertNotBot();
        return;
    }
    const proof = verifyToken<Verification>('review-verification', request.headers.get(VERIFICATION_HEADER));
    if (!proof || proof.projectId !== project.id || proof.origin !== siteOrigin || proof.authorId !== actorAuthorId(actor))
        throw apiErrors.botDetected();
}
