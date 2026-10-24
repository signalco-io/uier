import { getServiceStatus } from '../../../src/lib/status/serviceStatus';

export const dynamic = 'force-dynamic';

// GET /api/status - the live state of uier's services, for monitors: 200 when every service is
// operational, 503 otherwise (same checks as the /status page)
export async function GET() {
    const report = await getServiceStatus();
    return Response.json(report, {
        status: report.state === 'operational' ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' }
    });
}
