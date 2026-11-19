'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofArtifact, ProofManifest, ProofSurface } from '@/src/lib/proofs/model';
import type { ProofAnchor } from '@/src/lib/proofs/threadModel';
import { proofFetch } from './client';

const emailPolicy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function safeEmail(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, noscript, iframe, frame, object, embed, svg, math, base, link, meta, form, audio, video, input, button, textarea, select, template')
        .forEach(element => element.remove());
    const links = new Set<string>();
    template.content.querySelectorAll('*').forEach(element => {
        for (const attribute of [...element.attributes]) {
            if (attribute.name === 'href') {
                try {
                    const url = new URL(attribute.value);
                    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') links.add(url.href);
                } catch { /* Relative links have no trustworthy destination. */ }
            }
            if (attribute.name.startsWith('on') || ['href', 'srcset', 'ping', 'action', 'formaction', 'autofocus', 'target', 'background'].includes(attribute.name)
                || (attribute.name === 'src' && !/^data:image\/(?:gif|png|jpeg|webp);base64,/i.test(attribute.value)))
                element.removeAttribute(attribute.name);
        }
    });
    const documentHtml = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${emailPolicy}"></head><body>${template.innerHTML}</body></html>`;
    return { documentHtml, links: [...links].slice(0, 100) };
}

function useDocument<T>(url: string | undefined, parse: (text: string) => T) {
    const [result, setResult] = useState<{ url: string; value?: T; failed?: true }>();
    useEffect(() => {
        if (!url) return;
        const controller = new AbortController();
        void fetch(url, { signal: controller.signal, cache: 'no-store' }).then(response => {
            if (!response.ok || Number(response.headers.get('content-length')) > 4_000_000) throw new Error();
            return response.text();
        }).then(text => {
            if (text.length > 4_000_000) throw new Error();
            if (!controller.signal.aborted) setResult({ url, value: parse(text) });
        }).catch(() => { if (!controller.signal.aborted) setResult({ url, failed: true }); });
        return () => controller.abort();
    }, [url, parse]);
    return result?.url === url ? result : undefined;
}

const identity = (text: string) => text;

export function EmailProof({ manifest, body, plain, surfaceId, logicalWidth, renderedWidth, onAnchor }: {
    manifest: ProofManifest;
    body?: ProofArtifact;
    plain?: ProofArtifact;
    surfaceId: string;
    logicalWidth: number;
    renderedWidth: number;
    onAnchor?: (anchor: ProofAnchor) => void;
}) {
    const { t } = useAppI18n();
    const [mode, setMode] = useState<'html' | 'text'>(body ? 'html' : 'text');
    const html = useDocument(mode === 'html' ? body?.url : undefined, safeEmail);
    const text = useDocument(mode === 'text' ? plain?.url : undefined, identity);
    const scale = renderedWidth / logicalWidth;
    const frameHeight = 580;
    const links = [...new Set([...(manifest.email?.links ?? []), ...(html?.value?.links ?? [])])].slice(0, 100);
    const lines = [
        ['Subject', manifest.email?.subject],
        ['Preheader', manifest.email?.preheader],
        ['Sender', manifest.email?.sender]
    ] as const;
    const quote = (root: HTMLElement) => {
        const selection = window.getSelection();
        if (selection?.anchorNode && selection.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode)) {
            const quote = selection.toString().trim().slice(0, 500);
            if (quote) onAnchor?.({ kind: 'text', surfaceId, quote });
        }
    };

    return <div className="flex size-full flex-col overflow-auto bg-background text-sm">
        <div className="flex flex-wrap items-center gap-1 border-b p-2" data-proof-control="">
            {body && <Button size="sm" variant={mode === 'html' ? 'secondary' : 'ghost'} aria-pressed={mode === 'html'} onClick={() => setMode('html')}>{t('Safe HTML')}</Button>}
            {plain && <Button size="sm" variant={mode === 'text' ? 'secondary' : 'ghost'} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>{t('Plain text')}</Button>}
        </div>
        {lines.some(([, value]) => value) && <dl className="m-0 grid gap-2 border-b p-3">
            {lines.map(([label, value]) => value && <div key={label} className="flex flex-wrap items-center gap-x-2">
                <dt className="font-medium">{t(label)}</dt>
                <dd className="m-0 min-w-0 flex-1 break-words">{value}</dd>
                {onAnchor && <Button type="button" size="sm" variant="ghost" data-proof-control="" onClick={() => onAnchor({ kind: 'text', surfaceId, quote: value.slice(0, 500) })}>
                    {t('Annotate {field}', { field: t(label) })}
                </Button>}
            </div>)}
        </dl>}
        {mode === 'html' && html?.value && <>
            <div className="relative shrink-0 overflow-hidden" style={{ height: frameHeight * scale }}>
                <iframe title={t('Safe HTML email preview')} srcDoc={html.value.documentHtml} sandbox="" referrerPolicy="no-referrer"
                    className="absolute inset-0 block max-w-none origin-top-left border-0"
                    style={{ width: logicalWidth, height: frameHeight, transform: `scale(${scale})` }} />
            </div>
            {links.length > 0 && <details className="border-t p-3" data-proof-control="">
                <summary>{t('Link destinations')}</summary>
                <ul className="break-all">{links.map(link => <li key={link}>{link}</li>)}</ul>
            </details>}
        </>}
        {mode === 'text' && text?.value !== undefined &&
            <pre onPointerUp={event => quote(event.currentTarget)} onKeyUp={event => quote(event.currentTarget)}
                className="m-0 flex-1 whitespace-pre-wrap break-words p-3 font-sans">{text.value}</pre>}
        {(html?.failed || text?.failed) && <p role="alert" className="p-3 text-destructive">{t('This email preview could not be loaded.')}</p>}
        {!html && !text && <p role="status" className="p-3 text-muted-foreground">{t('Loading preview…')}</p>}
    </div>;
}

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

export function HtmlProof({ accessUrl, pages, surface, width, snapshot, onAnchor }: {
    accessUrl?: string; pages?: Record<string, string>; surface: ProofSurface; width: number;
    snapshot?: ReactNode; onAnchor?: (anchor: ProofAnchor) => void;
}) {
    const { t } = useAppI18n();
    const frame = useRef<HTMLIFrameElement>(null);
    const [url, setUrl] = useState<string>();
    const [captured, setCaptured] = useState(false);
    const [readyPath, setReadyPath] = useState<string>();
    const [picking, setPicking] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const logicalWidth = surface.width ?? 1280;
    const logicalHeight = surface.height ?? 800;

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

    useEffect(() => {
        if (!url || captured) return;
        function message(event: MessageEvent) {
            if (event.origin !== 'null' || event.source !== frame.current?.contentWindow
                || !event.data || typeof event.data !== 'object') return;
            const { type, path, x, y, quote } = event.data as Record<string, unknown>;
            if (typeof path !== 'string' || path.length > 1800) return;
            let page: string;
            try { page = decodeURIComponent(path); } catch { return; }
            const surfaceId = Object.entries(pages ?? {}).find(([, savedPath]) => savedPath === page)?.[0];
            if (type === 'uier-proof:ready') {
                setReadyPath(surfaceId);
                setPicking(false);
            }
            if (type === 'uier-proof:anchor' && picking && surfaceId && onAnchor) {
                if (typeof quote === 'string' && quote.trim()) onAnchor({ kind: 'text', surfaceId, quote: quote.trim().slice(0, 500) });
                else if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x + y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)
                    onAnchor({ kind: 'point', surfaceId, x, y });
                else return;
                frame.current?.contentWindow?.postMessage({ type: 'uier-proof:annotate', enabled: false }, '*');
                setPicking(false);
            }
        }
        window.addEventListener('message', message);
        return () => window.removeEventListener('message', message);
    }, [captured, onAnchor, pages, picking, url]);

    function retry() {
        setUrl(undefined);
        setFailed(false);
        setReadyPath(undefined);
        setPicking(false);
        setAttempt(value => value + 1);
    }

    return <>
        {url && !captured
            ? <iframe key={url} ref={frame} title={t('Interactive prototype')} sandbox="allow-scripts" referrerPolicy="no-referrer"
                src={url} className="absolute inset-0 block max-w-none origin-top-left border-0"
                style={{ width: logicalWidth, height: logicalHeight, transform: `scale(${width / logicalWidth})` }} />
            : snapshot ?? <p role={failed || !accessUrl ? 'alert' : 'status'} className="m-0 grid size-full place-items-center p-4 text-center">
                {t(failed || !accessUrl ? 'This prototype preview is unavailable.' : 'Loading preview…')}
            </p>}
        <div data-proof-control="" className="absolute bottom-1 left-1 z-10 flex max-w-full flex-wrap gap-1 rounded-lg bg-background/90 p-1">
            {url && snapshot && <Button size="sm" variant="outline" onClick={() => {
                setCaptured(value => !value);
                setReadyPath(undefined);
                setPicking(false);
            }}>{t(captured ? 'Interactive prototype' : 'Captured preview')}</Button>}
            {url && !captured && readyPath && onAnchor && <Button size="sm" variant="outline" aria-pressed={picking} onClick={() => {
                frame.current?.contentWindow?.postMessage({ type: 'uier-proof:annotate', enabled: !picking }, '*');
                setPicking(value => !value);
                frame.current?.focus();
            }}>{t(picking ? 'Cancel' : 'Pick a prototype element')}</Button>}
            {accessUrl && !captured && (failed || (url && !readyPath)) && <Button size="sm" variant="outline" onClick={retry}>{t('Retry preview')}</Button>}
        </div>
    </>;
}
