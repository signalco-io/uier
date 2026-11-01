'use client';
import { useEffect } from 'react';

/** Cookie-independent bridge inside a packaged extension-owned helper, never a reviewed page. */
export default function ExtensionVerification() {
    useEffect(() => {
        const receive = async (event: MessageEvent) => {
            if (event.source !== parent || !/^chrome-extension:\/\/[a-p]{32}$/.test(event.origin)) return;
            const data = event.data;
            if (data?.type !== 'uier:extension-verify' || !/^[A-Za-z0-9_-]{43}$/.test(data.id) || typeof data.token !== 'string' || data.token.length > 2048) return;
            let result;
            try {
                const response = await fetch('/api/extension/verification', { method: 'POST', credentials: 'omit', redirect: 'error',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
                    body: JSON.stringify({ clientId: event.origin.slice('chrome-extension://'.length) }) });
                if (response.ok) result = await response.json();
            } catch { /* Fail closed. */ }
            parent.postMessage({ type: 'uier:extension-verified', id: data.id, result }, event.origin);
        };
        addEventListener('message', receive);
        parent.postMessage({ type: 'uier:extension-verification-ready' }, '*');
        return () => removeEventListener('message', receive);
    }, []);
    return <p>Verifying your browser for uier.</p>;
}
