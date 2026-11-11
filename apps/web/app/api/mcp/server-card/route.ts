import { appBaseUrl } from '@/src/lib/app/request';
import { discoveryPreflight, discoveryResponse, serverCard } from '@/src/lib/mcp/serverCard';


/** The MCP Server Card, at the location reserved for it: `<endpoint>/server-card`. */
export async function GET(request: Request) {
    return discoveryResponse(request, serverCard(new URL(await appBaseUrl()).origin), 'application/mcp-server-card+json');
}
export const OPTIONS = discoveryPreflight;
