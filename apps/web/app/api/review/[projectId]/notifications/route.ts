import { z } from 'zod';
import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { parseJsonBody } from '@/src/lib/comments/http';
import { setProjectMuted } from '@/src/lib/notifications/preferences';

export const POST = reviewApiHandler(async ({ request, project, actor }) => {
    const { muted } = await parseJsonBody(request, z.object({ muted: z.boolean() }));
    await setProjectMuted(project, actor, muted);
    return Response.json({ muted });
});
export const OPTIONS = reviewPreflight('POST');
