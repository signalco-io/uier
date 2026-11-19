import { appBaseUrl } from '@/src/lib/app/request';
import { proofApi, type ProofRouteContext } from '@/src/lib/proofs/routes';

export const maxDuration = 120;
const handle = (request: Request, context: ProofRouteContext) => proofApi(request, context, appBaseUrl);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
