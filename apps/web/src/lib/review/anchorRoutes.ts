import { pagePath } from '@uier/toolbar/page-state';
import { apiErrors, parseJsonBody } from '../comments/http';
import { reattachAnchorSchema, isValidId } from '../comments/validation';
import { projectOrigins } from '../app/projects';
import { assertWriter } from './actor';
import { reattachProjectAnchor } from './comments';
import { commentResponse } from './response';
import type { ReviewApiContext } from './http';

/** Anchor updates are bound to the partition, exact saved page key, and reviewed origin. */
export async function reattachReviewAnchor(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor, siteOrigin } = context;
    assertWriter(actor);
    if (!isValidId(id)) throw apiErrors.notFound();
    const input = await parseJsonBody(request, reattachAnchorSchema);
    const origin = siteOrigin ?? new URL(request.url).origin;
    if (!projectOrigins(project).includes(origin)) throw apiErrors.forbidden('Open the reviewed page to change its anchor.');
    if (pagePath(input.path, project.pageState) !== input.path) throw apiErrors.invalidRequest('Use the saved page state.');
    const comment = await reattachProjectAnchor(project, actor, id, origin, input);
    return commentResponse(context, comment);
}
