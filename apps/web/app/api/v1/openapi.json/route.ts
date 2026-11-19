import { openapi } from '@/src/lib/rest/openapi';

export function GET() {
    return Response.json(openapi);
}
