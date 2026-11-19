'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofSurface } from '@/src/lib/proofs/model';
import { prototypeAnchorSchema, prototypeNodeLimit, prototypePathLimit, samePrototypeNode } from '@/src/lib/proofs/prototypeEvidence';
import type { ProofAnchor, ProofPrototypeAnchor } from '@/src/lib/proofs/threadModel';
import { cn } from '@/src/lib/utils';
import { proofFetch } from './client';

function isolatedUrl(input: string) {
    try {
        const url = new URL(input);
        const configured = process.env.NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN;
        const local = ['localhost', '127.0.0.1'].includes(location.hostname)
            && ['localhost', '127.0.0.1'].includes(url.hostname);
        if (configured && url.origin === new URL(configured).origin && url.hostname !== location.hostname
            && (url.protocol === 'https:' || (local && url.protocol === 'http:'))
            && url.pathname.startsWith('/proof-preview/') && !url.username && !url.password) return url.href;
    } catch { /* Missing and malformed renderer origins never become frames. */ }
}

export function HtmlProof({ accessUrl, pages, surface, width, snapshot, anchor, focusNonce, pins, onAnchor }: {
    accessUrl?: string; pages?: Record<string, string>; surface: ProofSurface; width: number;
    snapshot?: ReactNode; anchor?: ProofPrototypeAnchor; focusNonce?: number; pins?: boolean; onAnchor?: (anchor: ProofAnchor) => void;
}) {
    const { t } = useAppI18n();
    const frame = useRef<HTMLIFrameElement>(null);
    const pickButton = useRef<HTMLButtonElement>(null);
    const [url, setUrl] = useState<string>();
    const [ready, setReady] = useState<{ surfaceId: string }>();
    const [picking, setPicking] = useState(false);
    const [uncapturable, setUncapturable] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const [result, setResult] = useState<{ anchor?: ProofPrototypeAnchor; nonce?: number; restored: boolean }>();
    const [view, setView] = useState<{ anchor?: ProofPrototypeAnchor; nonce?: number; captured: boolean }>();
    const requestId = useRef(0);
    const channel = url && new URL(url).pathname.split('/')[2];
    const logicalWidth = surface.width ?? 1280;
    const logicalHeight = surface.height ?? 800;

    const restored = Boolean(result?.restored && result.anchor === anchor && result.nonce === focusNonce && ready?.surfaceId === anchor?.surfaceId);
    const captured = Boolean((anchor || snapshot) && (view && view.anchor === anchor && view.nonce === focusNonce ? view.captured : anchor && !restored));
    const post = useCallback((data: Record<string, unknown>) => {
        if (channel) frame.current?.contentWindow?.postMessage({ ...data, channel }, '*');
    }, [channel]);

    useEffect(() => {
        if (!accessUrl) return;
        const controller = new AbortController();
        void proofFetch<{ url: string }>(accessUrl, { signal: controller.signal }).then(response => {
            if (controller.signal.aborted) return;
            const verified = isolatedUrl(response.url);
            setUrl(verified);
            setFailed(!verified);
        }, () => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [accessUrl, attempt]);

    const message = useEffectEvent((event: MessageEvent) => {
        if (event.origin !== 'null' || event.source !== frame.current?.contentWindow
            || !event.data || typeof event.data !== 'object' || !channel || event.data.channel !== channel) return;
        const { type, path, request } = event.data as Record<string, unknown>;
        if (typeof path !== 'string' || path.length > 1800) return;
        let page: string;
        try { page = decodeURIComponent(path); } catch { return; }
        const surfaceId = Object.entries(pages ?? {}).find(([, savedPath]) => savedPath === page)?.[0];
        if (!surfaceId) return;
        if (type === 'uier-proof:ready') {
            setResult(undefined);
            setReady({ surfaceId });
            setPicking(false);
        } else if (type === 'uier-proof:restored' && request === requestId.current && typeof event.data.restored === 'boolean') {
            setResult({ anchor, nonce: focusNonce, restored: event.data.restored });
        } else if (type === 'uier-proof:begin-pick' && onAnchor && !captured) {
            post({ type: 'uier-proof:annotate', enabled: true });
            setPicking(true);
            setUncapturable(false);
        } else if (type === 'uier-proof:cancel') {
            setPicking(false);
            pickButton.current?.focus();
        } else if (type === 'uier-proof:uncapturable' && picking) {
            setUncapturable(true);
        } else if (type === 'uier-proof:anchor' && picking && onAnchor) {
            const { capture, target, selection } = event.data;
            // Check lengths before parsing arrays from an untrusted frame.
            const shortPath = (node: { path?: unknown } | undefined) => Array.isArray(node?.path) && node.path.length <= prototypePathLimit;
            if (!Array.isArray(capture?.nodes) || capture.nodes.length > prototypeNodeLimit || !Array.isArray(capture?.native)
                || capture.native.length > 8 || !shortPath(target) || capture.nodes.some((item: { node?: { path?: unknown } } | null) => !shortPath(item?.node))
                || capture.native.some((item: { node?: { path?: unknown } } | null) => !shortPath(item?.node))) return;
            const data = prototypeAnchorSchema.safeParse({ kind: 'prototype', surfaceId, target, capture, selection });
            if (!data.success) return;
            onAnchor(data.data);
            setPicking(false);
            setUncapturable(false);
            pickButton.current?.focus();
        }
    });

    useEffect(() => {
        const receive = (event: MessageEvent) => message(event);
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, []);

    useEffect(() => {
        const request = ++requestId.current;
        if (anchor && ready?.surfaceId === anchor.surfaceId) post({ type: 'uier-proof:restore', anchor, request, highlight: pins !== false });
        else post({ type: 'uier-proof:clear' });
        if (!anchor) return;
        const timer = window.setTimeout(() => setResult(previous => previous?.anchor === anchor && previous.nonce === focusNonce
            ? previous : { anchor, nonce: focusNonce, restored: false }), 2000);
        return () => window.clearTimeout(timer);
    }, [anchor, focusNonce, pins, post, ready]);

    function retry() {
        setUrl(undefined);
        setFailed(false);
        setReady(undefined);
        setResult(undefined);
        setPicking(false);
        setUncapturable(false);
        setView(undefined);
        setAttempt(value => value + 1);
    }

    return <>
        {url && <iframe key={url} ref={frame} title={t('Interactive prototype')} sandbox="allow-scripts" referrerPolicy="no-referrer"
            src={url} aria-hidden={captured || undefined} tabIndex={captured ? -1 : undefined}
            className="absolute inset-0 block max-w-none origin-top-left border-0"
            style={{ width: logicalWidth, height: logicalHeight, transform: `scale(${width / logicalWidth})` }} />}
        {captured ? <div className="absolute inset-0 overflow-hidden bg-background">
            {anchor ? <CapturedPrototype anchor={anchor} pins={pins !== false} /> : snapshot}
        </div> : !url && (snapshot ?? <p role={failed || !accessUrl ? 'alert' : 'status'} className="m-0 grid size-full place-items-center p-4 text-center">
            {t(failed || !accessUrl ? 'This prototype preview is unavailable.' : 'Loading preview…')}
        </p>)}
        <div data-proof-control="" className="absolute inset-x-1 bottom-1 z-10 flex flex-wrap items-center gap-1 rounded-lg bg-background/95 p-1">
            {captured && anchor && <p role="status" className="m-0 basis-full px-1 text-xs font-medium">
                {t((!result || restored) && !failed ? 'Captured prototype evidence' : 'Captured prototype evidence. The live state could not be restored.')}
            </p>}
            {url && (anchor || snapshot) && <Button size="sm" variant="outline" className="pointer-coarse:min-h-11" onClick={() => {
                setView({ anchor, nonce: focusNonce, captured: !captured });
                post({ type: 'uier-proof:annotate', enabled: false });
                setPicking(false);
            }}>{t(captured ? 'Interactive prototype' : 'Captured preview')}</Button>}
            {url && !captured && ready && onAnchor && <Button size="sm" variant="outline" className="pointer-coarse:min-h-11"
                ref={pickButton} aria-pressed={picking} aria-keyshortcuts="Alt+Shift+A" onClick={() => {
                    post({ type: 'uier-proof:annotate', enabled: !picking });
                    setPicking(!picking);
                    setUncapturable(false);
                    if (!picking) frame.current?.focus();
                }}>{t(picking ? 'Cancel' : 'Pick a prototype element')}</Button>}
            {picking && <Button size="sm" variant="outline" className="pointer-coarse:min-h-11"
                onClick={() => post({ type: 'uier-proof:use-selection' })}>{t('Use selected text')}</Button>}
            {picking && uncapturable && <p role="status" className="m-0 basis-full px-1 text-xs">{t('This element could not be captured. Choose another element.')}</p>}
            {picking && <p className="m-0 basis-full px-1 text-xs">{t('Click an element, or focus it and press Enter. Select text before using the selection.')}</p>}
            {accessUrl && (failed || (url && !ready)) && <Button size="sm" variant="outline" onClick={retry}>{t('Retry preview')}</Button>}
        </div>
    </>;
}

function CapturedPrototype({ anchor, pins }: { anchor: ProofPrototypeAnchor; pins: boolean }) {
    const { t } = useAppI18n();
    return <figure aria-label={t('Captured prototype evidence')} className="relative m-0 size-full bg-muted/50">
        {anchor.capture.nodes.map(({ node, box, label }) => {
            const target = samePrototypeNode(node, anchor.target);
            return <div key={node.path.join('.')} className={cn('absolute overflow-hidden rounded-sm border border-border bg-background/90 px-1 text-xs',
                target && pins && 'z-10 border-2 border-ring')}
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, minHeight: `${box.height * 100}%` }}>
                {target && anchor.selection ? <mark>{anchor.selection.quote}</mark> : label}
            </div>;
        })}
    </figure>;
}
