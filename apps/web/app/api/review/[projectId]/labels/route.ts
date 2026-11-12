import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { loadThreadLabels } from '@/src/lib/app/threadLabels';
import { apiErrors } from '@/src/lib/comments/http';
export const GET = reviewApiHandler(async ({ project, actor }) => {
    if (actor.kind !== 'member') throw apiErrors.forbidden();
    return Response.json(await loadThreadLabels(project));
});
export const OPTIONS = reviewPreflight('GET');
