// A static, empty document avoids loading the app UI, theme storage or analytics on customer sites.
// There are no interpolated request values. Credentials only travel in a same-origin API request.
const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>uier background sign-in</title></head><body><script>
window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || !/^https?:\\/\\//.test(event.origin)) return;
    const data = event.data;
    if (data?.type !== 'uier:session' || typeof data.id !== 'string' || data.id.length > 128
        || typeof data.project !== 'string' || !/^(?:[a-z0-9]{12}|[A-Za-z0-9_-]{21})$/.test(data.project)) return;
    try {
        const response = await fetch('/api/review/' + data.project + '/sso', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: event.origin })
        });
        const result = response.ok && response.status !== 204 ? await response.json() : undefined;
        window.parent.postMessage({ type: 'uier:session-result', id: data.id, token: result?.token }, event.origin);
    } catch {
        window.parent.postMessage({ type: 'uier:session-result', id: data.id }, event.origin);
    }
});
window.parent.postMessage({ type: 'uier:session-ready' }, '*');
</script></body></html>`;

export function GET() {
    return new Response(document, { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'
    } });
}
