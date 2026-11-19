'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofArtifact, ProofManifest } from '@/src/lib/proofs/model';
import type { ProofTextAnchor } from '@/src/lib/proofs/threadModel';
import { cn } from '@/src/lib/utils';
import { textMatches } from './pdfQuote';

const emailPolicy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function safeEmail(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, noscript, iframe, frame, object, embed, svg, math, base, link, meta, form, audio, video, input, button, textarea, select, template')
        .forEach(element => element.remove());
    const links = new Set<string>();
    const ctas: { index: number; quote: string }[] = [];
    template.content.querySelectorAll('*').forEach(element => {
        for (const attribute of [...element.attributes]) {
            if (attribute.name === 'href') {
                try {
                    const url = new URL(attribute.value);
                    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') links.add(url.href);
                } catch { /* Relative links have no trustworthy destination. */ }
            }
            if (attribute.name.startsWith('on') || ['href', 'srcset', 'ping', 'action', 'formaction', 'autofocus', 'target', 'background', 'data-proof-cta'].includes(attribute.name)
                || (attribute.name === 'src' && !/^data:image\/(?:gif|png|jpeg|webp);base64,/i.test(attribute.value)))
                element.removeAttribute(attribute.name);
        }
        if (element.localName === 'a' && ctas.length < 100) {
            const quote = normalize(element.textContent ?? '').slice(0, 500);
            if (quote) {
                element.setAttribute('data-proof-cta', String(ctas.length));
                ctas.push({ index: ctas.length, quote });
            }
        }
    });
    return { body: template.innerHTML, ctas, links: [...links].slice(0, 100) };
}

function emailFrame(body: string, cta: number | undefined) {
    const highlight = cta === undefined ? '' : `<style>[data-proof-cta="${cta}"]{outline: 3px solid Highlight !important}</style>`;
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${emailPolicy}">${highlight}</head><body>${body}</body></html>`;
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
const emailFields = [['Subject', 'subject'], ['Preheader', 'preheader'], ['Sender', 'sender']] as const;

function bodyQuote(text: string, anchor: ProofTextAnchor | undefined) {
    if (!anchor?.quote) return;
    // Keep original line breaks and find the matching copy in its normalized text.
    const parts = [...text.matchAll(/\S+/g)];
    const offsets: number[] = [];
    let normalized = '';
    for (const { 0: word, index } of parts) {
        if (normalized) { offsets.push(index - 1); normalized += ' '; }
        for (let character = 0; character < word.length; character++) offsets.push(index + character);
        normalized += word;
    }
    const matches = textMatches(normalized, anchor.quote, anchor.occurrence === undefined ? 2 : anchor.occurrence + 1);
    const position = anchor.occurrence === undefined ? (matches.length === 1 ? matches[0] : undefined) : matches[anchor.occurrence];
    if (position === undefined) return;
    const start = offsets[position];
    const end = offsets[position + normalize(anchor.quote).length - 1];
    if (start !== undefined && end !== undefined) return { start, end: end + 1 };
}

export function EmailProof({ manifest, body, plain, surfaceId, logicalWidth, renderedWidth, anchor, focusNonce, pins, onAnchor }: {
    manifest: ProofManifest;
    body?: ProofArtifact;
    plain?: ProofArtifact;
    surfaceId: string;
    logicalWidth: number;
    renderedWidth: number;
    anchor?: ProofTextAnchor;
    focusNonce?: number;
    pins?: boolean;
    onAnchor?: (anchor: ProofTextAnchor) => void;
}) {
    const { t } = useAppI18n();
    const [view, setView] = useState<{ mode: 'html' | 'text'; anchor?: ProofTextAnchor; nonce?: number }>();
    const mode = view && view.anchor === anchor && view.nonce === focusNonce ? view.mode
        : plain && (anchor?.field === 'body' || (anchor && !anchor.field) || !body) ? 'text' : 'html';
    const html = useDocument(mode === 'html' ? body?.url : undefined, safeEmail);
    const text = useDocument(mode === 'text' ? plain?.url : undefined, identity);
    const scale = renderedWidth / logicalWidth;
    const frameHeight = 580;
    const links = [...new Set([...(manifest.email?.links ?? []), ...(html?.value?.links ?? [])])].slice(0, 100);
    const field = anchor?.field;
    const focus = useRef<HTMLElement | null>(null);
    const cta = anchor && field === 'cta' && html?.value?.ctas.find(item => item.index === anchor.occurrence && item.quote === anchor.quote);
    const marked = pins && text?.value && (!field || field === 'body') ? bodyQuote(text.value, anchor) : undefined;
    const bodyLines = [...(text?.value ?? '').matchAll(/[^\r\n]+/g)].slice(0, 100);

    useEffect(() => {
        if (pins) focus.current?.scrollIntoView({ block: 'nearest' });
    }, [anchor, cta, focusNonce, html?.value, text?.value, pins]);

    const chooseBody = (quote: string, prefix: string) => {
        const value = normalize(quote).slice(0, 500);
        if (value) onAnchor?.({ kind: 'text', surfaceId, field: 'body', quote: value,
            occurrence: Math.min(100_000, textMatches(normalize(prefix), value).length) });
    };
    const selectBody = (root: HTMLElement) => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode
            || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
        const prefix = document.createRange();
        prefix.selectNodeContents(root);
        const selected = selection.getRangeAt(0);
        prefix.setEnd(selected.startContainer, selected.startOffset);
        chooseBody(selection.toString(), prefix.toString());
    };
    const changeMode = (mode: 'html' | 'text') => setView({ mode, anchor, nonce: focusNonce });

    return <div className="flex size-full flex-col overflow-auto bg-background text-sm">
        <div className="flex flex-wrap items-center gap-1 border-b p-2" data-proof-control="">
            {body && <Button size="sm" variant={mode === 'html' ? 'secondary' : 'ghost'} aria-pressed={mode === 'html'} onClick={() => changeMode('html')}>{t('Safe HTML')}</Button>}
            {plain && <Button size="sm" variant={mode === 'text' ? 'secondary' : 'ghost'} aria-pressed={mode === 'text'} onClick={() => changeMode('text')}>{t('Plain text')}</Button>}
        </div>
        <dl className="m-0 grid gap-2 border-b p-3">
            {emailFields.map(([label, key]) => {
                const value = manifest.email?.[key];
                const selected = pins && field === key && value === anchor?.quote;
                return value && <div key={key} className="flex flex-wrap items-center gap-x-2">
                    <dt className="font-medium">{t(label)}</dt>
                    <dd className="m-0 min-w-0 flex-1 break-words">{selected ? <mark ref={focus}>{value}</mark> : value}</dd>
                    {onAnchor && <Button size="sm" variant="ghost" data-proof-control="" className="pointer-coarse:min-h-11"
                        onClick={() => onAnchor({ kind: 'text', surfaceId, quote: value, field: key })}>
                        {t('Annotate {field}', { field: t(label) })}
                    </Button>}
                </div>;
            })}
        </dl>
        {mode === 'html' && html?.value && <>
            {html.value.ctas.length > 0 && (onAnchor || cta) && <details key={cta ? cta.index : 'links'} open={cta ? true : undefined} className="border-b p-3" data-proof-control="">
                <summary>{t('Email calls to action')}</summary>
                <ul className="list-none p-0">{html.value.ctas.map(({ index, quote }) => <li key={index}>
                    {onAnchor ? <Button size="sm" variant={cta && cta.index === index && pins ? 'secondary' : 'ghost'}
                        className="h-auto min-h-8 w-full justify-start whitespace-normal text-left pointer-coarse:min-h-11"
                        onClick={() => onAnchor({ kind: 'text', surfaceId, quote, field: 'cta', occurrence: index })}>
                        {t('Annotate {field}', { field: quote })}
                    </Button> : cta && cta.index === index ? <span>{quote}</span> : null}
                </li>)}</ul>
            </details>}
            <div className="relative shrink-0 overflow-hidden" style={{ height: frameHeight * scale }}>
                <iframe title={t('Safe HTML email preview')} srcDoc={emailFrame(html.value.body, cta && pins ? cta.index : undefined)} sandbox="" referrerPolicy="no-referrer"
                    className="absolute inset-0 block max-w-none origin-top-left border-0"
                    style={{ width: logicalWidth, height: frameHeight, transform: `scale(${scale})` }} />
            </div>
            {links.length > 0 && <details className="border-t p-3" data-proof-control="">
                <summary>{t('Link destinations')}</summary>
                <ul className="break-all">{links.map(link => <li key={link}>{link}</li>)}</ul>
            </details>}
        </>}
        {mode === 'text' && text?.value !== undefined && <>
            {onAnchor && bodyLines.length > 0 && <details className="border-b p-3" data-proof-control="">
                <summary>{t('Choose body text')}</summary>
                <ul className="list-none p-0">{bodyLines.map(({ 0: line, index }) => <li key={index}>
                    <Button size="sm" variant="ghost" className="h-auto min-h-8 w-full justify-start whitespace-normal text-left pointer-coarse:min-h-11"
                        onClick={() => chooseBody(line, text.value!.slice(0, index))}>{line.slice(0, 500)}</Button>
                </li>)}</ul>
            </details>}
            <pre onPointerUp={event => selectBody(event.currentTarget)} onKeyUp={event => { if (event.shiftKey) selectBody(event.currentTarget); }}
                className="m-0 flex-1 whitespace-pre-wrap break-words p-3 font-sans">{marked
                    ? <>{text.value.slice(0, marked.start)}<mark ref={focus}>{text.value.slice(marked.start, marked.end)}</mark>{text.value.slice(marked.end)}</> : text.value}</pre>
        </>}
        {(html?.failed || text?.failed) && <p role="alert" className="p-3 text-destructive">{t('This email preview could not be loaded.')}</p>}
        {!html && !text && <p role="status" className="p-3 text-muted-foreground">{t('Loading preview…')}</p>}
    </div>;
}
