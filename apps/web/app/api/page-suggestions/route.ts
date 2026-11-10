import { assertNotBot } from '../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../src/lib/comments/http';
import { enforceRewriteLimits } from '../../../src/lib/comments/rateLimits';
import { rewriteLimitSubject } from '../../../src/lib/comments/service';
import { getCommentsStore } from '../../../src/lib/repo/commentsStore';
import { pageSuggestionsRequestSchema } from '../../../src/lib/pageSuggestions/schema';
import { suggestPageText } from '../../../src/lib/pageSuggestions/suggest';
import { isRewriteConfigured } from '../../../src/lib/rewrite/suggest';
import { effectiveRewriteInstructions } from '../../../src/lib/rewrite/settings';
import { getWorkspace } from '../../../src/lib/app/workspaces';

// The model call ends within 45 s (src/lib/rewrite/suggest.ts); BotID and the rate limits run before it
export const maxDuration = 60;

// POST /api/page-suggestions - { kind, text, title?, description? } -> { suggestions }: a page's
// AI suggestions (titles, meta descriptions, the questions it answers), counted with rewrite
// suggestions. Asking for suggestions never sets the visitor cookie (only a comment or reply does).
export const POST = commentsApiHandler(async (context) => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, pageSuggestionsRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Page suggestions are not available here.');

    const guidance = context.project ? effectiveRewriteInstructions(await getWorkspace(context.project.workspaceId), context.project) : '';
    await enforceRewriteLimits(getCommentsStore(), rewriteLimitSubject(context));
    return Response.json({ suggestions: await suggestPageText(input, guidance) });
}, { createVisitor: false });
