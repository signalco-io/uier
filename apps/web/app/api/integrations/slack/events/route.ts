import { receiveSlackEvent } from '@/src/lib/integrations/slack/events';

// Slack event payloads are small; a message is at most 40,000 characters.
const MAX_BODY_BYTES = 512 * 1024;

export async function POST(request: Request) {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    const result = await receiveSlackEvent(raw, request.headers);
    return new Response(result.body ?? null, { status: result.status,
        headers: { 'Cache-Control': 'no-store', ...(result.body ? { 'Content-Type': 'application/json' } : {}) } });
}
