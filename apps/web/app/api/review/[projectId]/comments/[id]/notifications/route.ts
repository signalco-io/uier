import { z } from 'zod';
import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { parseJsonBody } from '@/src/lib/comments/http';
import { followThread, threadNotificationState } from '@/src/lib/notifications/preferences';
import { appBaseUrl, requestIpBucket } from '@/src/lib/app/request';

export const dynamic = 'force-dynamic';
export const GET = reviewApiHandler<{ projectId: string; id: string }>(async ({ project, actor }, { id }) =>
    Response.json(await threadNotificationState(project, actor, id)));
export const POST = reviewApiHandler<{ projectId: string; id: string }>(async ({ request, project, actor }, { id }) => {
    const input = await parseJsonBody(request, z.object({ following: z.boolean(), email: z.string().max(254).optional() }));
    return Response.json(await followThread(project, actor, id, input.following, input.email, await appBaseUrl(), await requestIpBucket()));
});
export const OPTIONS = reviewPreflight('GET, POST');
