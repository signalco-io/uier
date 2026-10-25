import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { projectFeedbackExport } from '@/src/lib/review/feedbackContext';

import { appBaseUrl } from '@/src/lib/app/request';

export const dynamic = 'force-dynamic';
export const GET = reviewApiHandler<{ projectId: string; id: string }>(async ({ project, actor, siteOrigin }, { id }) =>
    Response.json(await projectFeedbackExport(project, actor, id, siteOrigin, await appBaseUrl())));
export const OPTIONS = reviewPreflight('GET');
