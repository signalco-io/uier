import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

/** BotID's local human verdict issues the same signed proof used by the browser bridge. */
export async function verifiedReviewHeaders(request: APIRequestContext, projectId: string, origin: string, visitor = randomBytes(32).toString('base64url')) {
    const headers = { 'X-Uier-Visitor': visitor };
    const response = await request.post(`/api/review/${projectId}/verification`, { headers, data: { origin } });
    expect(response.status()).toBe(200);
    const { token } = await response.json() as { token: string };
    return { ...headers, Origin: origin, 'X-Uier-Verification': token };
}
