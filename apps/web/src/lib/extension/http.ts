import { isExtensionTransportOrigin } from './config';
import { apiErrors, errorResponse } from '../comments/http';

export function extensionApiOrigin(request: Request) {
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '');
    return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

/** Extension origins affect transport only. Identity always requires a live purpose-bound token. */
export function extensionHandler(handler: (request: Request) => Promise<Response>) {
    return async (request: Request) => {
        let response: Response;
        const origin = request.headers.get('origin');
        const allowed = isExtensionTransportOrigin(origin);
        try {
            if (origin && origin !== extensionApiOrigin(request) && !allowed) throw apiErrors.forbidden();
            response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await handler(request);
        } catch (error) { response = errorResponse(error); }
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('Vary', 'Origin');
        if (allowed) {
            headers.set('Access-Control-Allow-Origin', origin!);
            headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Uier-Verification');
            headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
            headers.set('Access-Control-Expose-Headers', 'Retry-After');
        }
        return new Response(response.body, { status: response.status, headers });
    };
}
