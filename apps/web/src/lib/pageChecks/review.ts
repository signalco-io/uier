import { pagePath } from '@uier/toolbar/page-state';
import { projectReviewOrigin } from '../app/projects';
import { apiErrors, parseJsonBody } from '../comments/http';
import { newSourcePath } from '../comments/dto';
import { actorAuthorId } from '../review/actor';
import type { ReviewApiContext } from '../review/http';
import { enforcePageCheckLimits } from './limits';
import { pageCheckInputSchema } from './schema';
import { savePageCheck } from './store';

/**
 * `POST /api/review/<code>/page-checks`: a project member's toolbar saves what the checks found on
 * the page it reviews. Only members (never guests or public viewers); the review API's identity,
 * CORS, origin and verification checks run first (`reviewApiHandler`). The page is keyed like the
 * project's comments: the site's origin and the canonical page key under the project's page state.
 */
export async function savePageChecksFromReview({ request, project, actor, siteOrigin }: ReviewApiContext) {
    if (actor.kind !== 'member')
        throw apiErrors.forbidden('Only project members can save page checks.');
    const input = await parseJsonBody(request, pageCheckInputSchema);
    await enforcePageCheckLimits(project.id, actorAuthorId(actor)!);
    const origin = projectReviewOrigin(project, request, siteOrigin);
    if (!origin)
        throw apiErrors.forbidden('This site is not one of the project\'s addresses.');
    const path = pagePath(input.path, project.pageState);
    const { sourcePath: rawSource, ...summary } = input;
    const sourcePath = newSourcePath(path, rawSource, project.pageState);
    await savePageCheck(project.id, { ...summary, origin, path, sourcePath });
    return new Response(null, { status: 204 });
}
