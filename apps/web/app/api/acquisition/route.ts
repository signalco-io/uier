import { z } from 'zod';
import { appBaseUrl } from '@/src/lib/app/request';
import { getSessionUser } from '@/src/lib/app/session';
import { claimAcquisitionEvents } from '@/src/lib/acquisition/server';
import { channels, sources } from '@/src/lib/acquisition/types';
import { parseJsonBody } from '@/src/lib/comments/http';

export const dynamic = 'force-dynamic';
const input = z.object({ channel: z.enum(channels), source: z.enum(sources) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
    if (request.headers.get('origin') !== await appBaseUrl()) return json({ error: 'Forbidden' }, 403);
    const user = await getSessionUser();
    if (!user) return json({ error: 'Sign in required' }, 401);
    let parsed;
    try { parsed = await parseJsonBody(request, input, 256); } catch { return json({ error: 'Invalid request' }, 400); }
    try { return json(await claimAcquisitionEvents(user.id, parsed)); }
    catch { return json({ error: 'Measurement unavailable' }, 503); }
}
