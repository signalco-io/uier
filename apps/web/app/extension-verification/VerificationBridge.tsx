'use client';
import { useEffect } from 'react';

/** Cookie-independent bridge inside a packaged extension-owned helper, never a reviewed page. */
export function ExtensionVerificationBridge({ origins, clientId }: { origins: string[]; clientId?: string }) {
    useEffect(() => {
        const receive = async (event: MessageEvent) => {
            if (event.source !== parent || !origins.includes(event.origin)) return;
            const data = event.data;
            if (data?.type !== 'uier:extension-verify' || !/^[A-Za-z0-9_-]{43}$/.test(data.id) || typeof data.token !== 'string' || data.token.length > 2048) return;
            let result;
            try {
                const response = await fetch('/api/extension/verification', { method: 'POST', credentials: 'omit', redirect: 'error',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
                    body: JSON.stringify({ clientId: clientId ?? event.origin.slice('chrome-extension://'.length), extensionOrigin: event.origin }) });
                if (response.ok) result = await response.json();
            } catch { /* Fail closed. */ }
            parent.postMessage({ type: 'uier:extension-verified', id: data.id, result }, event.origin);
        };
        addEventListener('message', receive);
        parent.postMessage({ type: 'uier:extension-verification-ready' }, '*');
        return () => removeEventListener('message', receive);
    }, [origins, clientId]);
    return <p>Verifying your browser for uier.</p>;
}
