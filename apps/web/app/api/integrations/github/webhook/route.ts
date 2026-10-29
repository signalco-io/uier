import { receiveGitHubWebhook } from '@/src/lib/integrations/github';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    const result = await receiveGitHubWebhook(raw, request.headers);
    return new Response(null, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
