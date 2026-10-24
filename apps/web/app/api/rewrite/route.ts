import { assertNotBot } from '../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../src/lib/comments/http';
import { enforceRewriteLimits } from '../../../src/lib/comments/rateLimits';
import { rewriteLimitSubject } from '../../../src/lib/comments/service';
import { rewriteRequestSchema } from '../../../src/lib/comments/validation';
import { getCommentsStore } from '../../../src/lib/repo/commentsStore';
import { isRewriteConfigured, suggestRewrites } from '../../../src/lib/rewrite/suggest';

// The model call ends within 45 s (suggest.ts); BotID and the rate limits run before it
export const maxDuration = 60;

// POST /api/rewrite - { text, instruction? } -> { suggestions }: rewrites of selected page text.
// Asking for suggestions never sets the visitor cookie (only a comment or reply does).
export const POST = commentsApiHandler(async (context) => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, rewriteRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Rewrite suggestions are not available here.');

    await enforceRewriteLimits(getCommentsStore(), rewriteLimitSubject(context));
    return Response.json({ suggestions: await suggestRewrites(input.text, input.instruction) });
}, { createVisitor: false });
