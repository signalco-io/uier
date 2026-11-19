import { ApiError, errorResponse } from '@/src/lib/comments/http';
import { receiveProofEmail } from '@/src/lib/proofs/emailIngress';

export const maxDuration = 120;
export async function POST(request: Request) {
    try {
        return Response.json(await receiveProofEmail(request), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        return errorResponse(error instanceof ApiError ? error : new ApiError(500, 'server_error', 'Email delivery could not be processed.'));
    }
}
