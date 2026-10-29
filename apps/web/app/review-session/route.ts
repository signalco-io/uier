import { sessionScript, sessionContentSecurityPolicy } from '@/src/lib/review/sessionDocument';

// A static, empty document avoids loading the app UI, theme storage or analytics on customer sites.
// There are no interpolated request values. Credentials only travel in a same-origin API request.
const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>uier background sign-in</title></head><body><script>${sessionScript}</script></body></html>`;

export function GET() {
    return new Response(document, { headers: {
        'Content-Security-Policy': sessionContentSecurityPolicy,
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'
    } });
}
