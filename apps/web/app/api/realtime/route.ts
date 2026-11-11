import { upgradeWebSocket } from '@vercel/functions';
import { acceptRealtimeSocket } from '../../../src/lib/realtime/socket';
import { realtimeApiOrigin } from '../../../src/lib/realtime/tickets';

export const maxDuration = 300;

export async function GET(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
        return new Response(null, { status: 426, headers: { Upgrade: 'websocket', 'Cache-Control': 'no-store' } });
    const origin = request.headers.get('origin');
    if (!origin || origin === 'null') return new Response(null, { status: 403 });
    return upgradeWebSocket(socket => acceptRealtimeSocket(socket, origin, realtimeApiOrigin(request)), { maxPayload: 2048 });
}
