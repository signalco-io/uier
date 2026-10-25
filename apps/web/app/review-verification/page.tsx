'use client';

import { useEffect } from 'react';

/** An empty, frameable page: only the parent receives its own verification result. */
export default function ReviewVerificationPage() {
    useEffect(() => {
        const receive = async (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin === 'null')
                return;
            const data = event.data;
            if (data?.type !== 'uier:verify' || typeof data.id !== 'string'
                || typeof data.project !== 'string' || !/^[a-z0-9]{12}$/.test(data.project)
                || typeof data.visitor !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.visitor))
                return;
            try {
                const response = await fetch(`/api/review/${data.project}/verification`, {
                    method: 'POST',
                    credentials: 'omit',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Uier-Visitor': data.visitor,
                        ...(typeof data.authorization === 'string' ? { Authorization: data.authorization } : {})
                    },
                    // The browser's message origin, never a value supplied by the parent.
                    body: JSON.stringify({ origin: event.origin })
                });
                const result = response.ok ? await response.json() : undefined;
                window.parent.postMessage({ type: 'uier:verified', id: data.id, result }, event.origin);
            } catch {
                window.parent.postMessage({ type: 'uier:verified', id: data.id }, event.origin);
            }
        };
        window.addEventListener('message', receive);
        window.parent.postMessage({ type: 'uier:verification-ready' }, '*');
        return () => window.removeEventListener('message', receive);
    }, []);
    return null;
}
