import { assertNotBot } from '../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../src/lib/comments/http';
import { enforceRewriteLimits } from '../../../src/lib/comments/rateLimits';
import { rateLimitSubject } from '../../../src/lib/comments/service';
import { rewriteRequestSchema } from '../../../src/lib/comments/validation';
import { getCommentsStore } from '../../../src/lib/repo/commentsStore';
import { isRewriteConfigured, suggestRewrites } from '../../../src/lib/rewrite/suggest';

// The model is asked for a few short suggestions; leave room for a slow answer and one retry
export const maxDuration = 60;

// POST /api/rewrite - { text, instruction? } -> { suggestions }: rewrites of selected page text
export const POST = commentsApiHandler(async (context) => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, rewriteRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Rewrite suggestions are not available here.');

    await enforceRewriteLimits(getCommentsStore(), rateLimitSubject(context));
    return Response.json({ suggestions: await suggestRewrites(input.text, input.instruction) });
});
