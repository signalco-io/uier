import { appBaseUrl } from '@/src/lib/app/request';
import { handleMcp } from '@/src/lib/mcp/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
    return handleMcp(request, new URL(await appBaseUrl()).origin);
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
