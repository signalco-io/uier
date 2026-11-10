import { appBaseUrl } from '@/src/lib/app/request';
import { aiCatalog, discoveryPreflight, discoveryResponse } from '@/src/lib/mcp/serverCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Served at /.well-known/ai-catalog.json (next.config.ts rewrite) */
export async function GET(request: Request) {
    return discoveryResponse(request, aiCatalog(new URL(await appBaseUrl()).origin), 'application/ai-catalog+json');
}
export const OPTIONS = discoveryPreflight;
