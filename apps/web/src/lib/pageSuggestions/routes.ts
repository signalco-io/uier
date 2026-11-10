import { getWorkspace } from '../app/workspaces';
import { apiErrors, parseJsonBody } from '../comments/http';
import { assertWriter } from '../review/actor';
import { enforceProjectRewriteLimits } from '../review/comments';
import type { ReviewApiContext } from '../review/http';
import { effectiveRewriteInstructions } from '../rewrite/settings';
import { isRewriteConfigured } from '../rewrite/suggest';
import { pageSuggestionsRequestSchema } from './schema';
import { suggestPageText } from './suggest';

/**
 * POST /api/review/<code>/page-suggestions: a page's AI suggestions for those who can comment, like
 * the project's rewrite suggestions (the same limits, counters and style guidance)
 */
export async function suggestReviewPageText({ request, project, actor }: ReviewApiContext) {
    assertWriter(actor);
    const input = await parseJsonBody(request, pageSuggestionsRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Page suggestions are not available here.');

    const guidance = effectiveRewriteInstructions(await getWorkspace(project.workspaceId), project);
    await enforceProjectRewriteLimits(request, project, actor);
    return Response.json({ suggestions: await suggestPageText(input, guidance) });
}
