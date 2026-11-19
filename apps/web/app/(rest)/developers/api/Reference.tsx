'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import type { createApiReference } from '@scalar/api-reference';

declare global {
    interface Window { Scalar?: { createApiReference: typeof createApiReference } }
}

export function Reference() {
    const target = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!ready || !target.current || !window.Scalar) return;
        const reference = window.Scalar.createApiReference(target.current, {
            url: '/api/v1/openapi.json', baseServerURL: window.location.origin,
            persistAuth: false, proxyUrl: '', telemetry: false, withDefaultFonts: false,
            agent: { disabled: true }, hideClientButton: true, showDeveloperTools: 'never'
        });
        return () => reference.destroy();
    }, [ready]);

    return <>
        <Script src="/scalar/standalone.js" onReady={() => setReady(true)} onError={() => setFailed(true)} />
        {failed && <p role="status" className="p-6">The interactive reference could not load. Download the OpenAPI document above.</p>}
        <div ref={target} />
    </>;
}
