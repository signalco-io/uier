import { actOnNotificationToken, inspectNotificationToken } from '@/src/lib/notifications/preferences';
import { ApiError } from '@/src/lib/comments/http';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

/** Scanners and browsers may inspect this URL without changing preferences. */
export function GET() { return new Response(null, { status: 200, headers }); }

export async function POST(request: Request) {
    try {
        const type = request.headers.get('content-type')?.split(';')[0];
        if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') return new Response(null, { status: 415, headers });
        // The small RFC 8058 body has no other fields; bound even chunked uploads.
        const reader = request.body?.getReader();
        if (!reader) return new Response(null, { status: 400, headers });
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
            chunks.push(value);
        }
        const body = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type')! }, body: Buffer.concat(chunks) }).formData();
        if ([...body.keys()].length !== 1 || body.get('List-Unsubscribe') !== 'One-Click') return new Response(null, { status: 400, headers });
        const token = new URL(request.url).searchParams.get('token');
        const inspected = await inspectNotificationToken(token);
        if (!inspected || inspected.payload.mode === 'verify') return new Response(null, { status: 404, headers });
        await actOnNotificationToken(token, inspected.payload.mode === 'project' ? 'mute' : 'unsubscribe');
        return new Response(null, { status: 200, headers });
    } catch (error) {
        return new Response(null, { status: error instanceof ApiError ? error.status : 503, headers });
    }
}
