/** The host that may serve user-supplied prototype bytes. */
export function proofPreviewOrigin() {
    const value = process.env.NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN;
    if (!value) return;
    try {
        const url = new URL(value);
        const local = process.env.NODE_ENV === 'development' || process.env.UIER_LOCAL === '1';
        if (url.pathname !== '/' || url.username || url.password || url.search || url.hash
            || /(^|\.)uier\.io$/i.test(url.hostname)) return;
        if (url.protocol === 'https:' || (local && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url;
    } catch { /* Configuration is invalid. */ }
}
