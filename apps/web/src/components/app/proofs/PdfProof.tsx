'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, version as pdfVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

export type PdfDocument = PDFDocumentProxy;
export type PdfResult = { number: number; text: string };

type PdfPageSize = { width: number; height: number };

export function PdfProof({ url, pageNumber, width, onDocument, onSize, onText, quote, onQuoteTarget }: {
    url: string; pageNumber: number; width: number; onDocument?: (document: PdfDocument) => void;
    onSize?: (size: PdfPageSize) => void; onText?: (text: string) => void; quote?: string; onQuoteTarget?: (point: { x: number; y: number }) => void;
}) {
    const { t } = useAppI18n();
    const [document, setDocument] = useState<PdfDocument>();
    const [page, setPage] = useState<PDFPageProxy>();
    const [error, setError] = useState(false);
    const [ready, setReady] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null);
    const layer = useRef<HTMLDivElement>(null);
    const [textReady, setTextReady] = useState(0);
    useEffect(() => {
        const task = getDocument({
            url, enableXfa: false,
            cMapUrl: `/proof-pdf/${pdfVersion}/cmaps/`, cMapPacked: true, standardFontDataUrl: `/proof-pdf/${pdfVersion}/standard_fonts/`,
            wasmUrl: `/proof-pdf/${pdfVersion}/wasm/`, canvasMaxAreaInBytes: 36_000_000
        });
        let active = true;
        task.promise.then(value => {
            if (active) { setDocument(value); onDocument?.(value); }
        }, () => { if (active) setError(true); });
        return () => { active = false; void task.destroy().catch(() => {}); };
    }, [url, onDocument]);
    useEffect(() => {
        if (!document) return;
        let active = true;
        document.getPage(pageNumber).then(value => {
            if (!active) return;
            const { width, height } = value.getViewport({ scale: 1 });
            onSize?.({ width, height });
            setPage(value);
        }, () => { if (active) setError(true); });
        return () => { active = false; };
    }, [document, pageNumber, onSize]);
    useEffect(() => {
        const paint = canvas.current;
        const text = layer.current;
        if (!page || page.pageNumber !== pageNumber || !paint || !text || !width) return;
        let active = true;
        let render: RenderTask | undefined;
        let textLayer: TextLayer | undefined;
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
        paint.width = Math.ceil(viewport.width * ratio);
        paint.height = Math.ceil(viewport.height * ratio);
        text.replaceChildren();
        text.style.setProperty('--scale-factor', String(viewport.scale));
        text.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit));
        render = page.render({ canvas: paint, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        render.promise.then(() => { if (active) setReady(true); }, () => { if (active) setError(true); });
        void page.getTextContent().then(content => {
                if (!active) return;
                onText?.(content.items.flatMap(item => 'str' in item ? [item.str + (item.hasEOL ? '\n' : ' ')] : []).join('').trim());
                textLayer = new TextLayer({ textContentSource: content, container: text, viewport });
                return textLayer.render().then(() => { if (active) setTextReady(value => value + 1); });
            }).catch(() => { if (active) text.replaceChildren(); });
        return () => {
            active = false;
            render?.cancel();
            textLayer?.cancel();
        };
    }, [onText, page, pageNumber, width]);

    useEffect(() => {
        const root = layer.current;
        if (!root || !textReady) return;
        root.querySelectorAll<HTMLElement>('[data-proof-quote]').forEach(span => delete span.dataset.proofQuote);
        const match = quote && pdfHighlight(root, quote);
        if (match) {
            const bounds = root.getBoundingClientRect();
            const first = match.getBoundingClientRect();
            if (bounds.width && bounds.height)
                onQuoteTarget?.({ x: (first.left + first.width / 2 - bounds.left) / bounds.width, y: (first.top + first.height / 2 - bounds.top) / bounds.height });
        }
    }, [quote, textReady, onQuoteTarget]);

    if (error) return <p role="alert" className="m-0 grid size-full place-items-center p-4 text-center text-destructive">{t('This PDF page could not be rendered.')}</p>;
    return <div className="relative size-full bg-background">
        {!ready && <div role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-muted-foreground">{t('Rendering PDF page…')}</div>}
        <canvas ref={canvas} aria-label={t('Page {number}', { number: pageNumber })} className="absolute inset-0 block size-full" />
        <div ref={layer} className="proof-pdf-text textLayer" />
    </div>;
}

export function PdfThumbnail({ document, page, label, active, onClick }: {
    document: PdfDocument; page: number; label: string; active: boolean; onClick: () => void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (visible) return;
        const node = canvas.current;
        if (!node) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) setVisible(true);
        }, { rootMargin: '80px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [visible]);
    useEffect(() => {
        const node = canvas.current;
        if (!node || !visible) return;
        let alive = true;
        let render: RenderTask | undefined;
        void document.getPage(page).then(proxy => {
            if (!alive) return;
            const base = proxy.getViewport({ scale: 1 });
            const viewport = proxy.getViewport({ scale: Math.min(128 / base.width, 144 / base.height) });
            node.width = Math.ceil(viewport.width);
            node.height = Math.ceil(viewport.height);
            render = proxy.render({ canvas: node, viewport });
            return render.promise;
        }).catch(() => {});
        return () => { alive = false; render?.cancel(); };
    }, [document, page, visible]);
    return (
        <Button variant={active ? 'secondary' : 'ghost'} className="h-auto w-20 shrink-0 flex-col gap-1 overflow-hidden p-1"
            aria-current={active ? 'page' : undefined} onClick={onClick} aria-label={label}>
            <canvas ref={canvas} width={128} height={144} aria-hidden className="block h-16 w-full object-contain" />
            <span className="text-xs">{page}</span>
        </Button>
    );
}

export function PdfSearch({ document, onPage }: { document: PdfDocument; onPage: (number: number) => void }) {
    const { t } = useAppI18n();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PdfResult[]>();
    const [error, setError] = useState(false);
    const [searching, setSearching] = useState(false);
    const searchCounter = useRef(0);
    useEffect(() => () => { searchCounter.current++; }, []);
    async function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return;
        const identifier = ++searchCounter.current;
        setSearching(true);
        setError(false);
        setResults(undefined);
        try {
            const found: PdfResult[] = [];
            for (let number = 1; number <= document.numPages && identifier === searchCounter.current; number++) {
                const { items } = await (await document.getPage(number)).getTextContent();
                const text = items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
                const index = text.toLocaleLowerCase().indexOf(needle);
                if (index >= 0) found.push({ number, text: text.slice(Math.max(0, index - 40), index + needle.length + 80) });
            }
            if (identifier === searchCounter.current) setResults(found);
        } catch {
            if (identifier === searchCounter.current) setError(true);
        } finally {
            if (identifier === searchCounter.current) setSearching(false);
        }
    }
    return (
        <div className="grid gap-2">
            <form onSubmit={search} className="flex gap-2">
                <Input type="search" aria-label={t('Find in PDF')} placeholder={t('Find in PDF')} value={query} onChange={event => setQuery(event.target.value)} />
                <Button type="submit" variant="outline" disabled={!query.trim()}>{t('Search')}</Button>
            </form>
            {searching && <span role="status" className="text-sm text-muted-foreground">{t('Searching…')}</span>}
            {error && <span role="alert" className="text-sm text-destructive">{t('PDF text search failed.')}</span>}
            {results && (results.length ? <ul className="m-0 max-h-40 list-none divide-y overflow-auto rounded-lg border p-0">
                {results.map(result => <li key={result.number}>
                    <Button variant="ghost" onClick={() => onPage(result.number)} className="h-auto w-full justify-start whitespace-normal text-left">
                        {t('Page {number}', { number: result.number })} · {result.text}</Button>
                </li>)}
            </ul> : <span role="status" className="text-sm text-muted-foreground">{t('No matching PDF text')}</span>)}
        </div>
    );
}

export function pdfHighlight(layer: HTMLElement, quote: string) {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[role="presentation"]'));
    let text = '';
    const ranges = spans.flatMap(span => {
        const value = normalize(span.textContent ?? '');
        if (!value) return [];
        const start = text.length;
        text += value + ' ';
        return [{ start, end: text.length - 1, span }];
    });
    const needle = normalize(quote);
    if (!needle) return;
    const start = text.indexOf(needle);
    if (start < 0 || text.indexOf(needle, start + 1) !== -1) return;
    const matches = ranges.filter(range => range.end > start && range.start < start + needle.length);
    for (const { span } of matches) span.dataset.proofQuote = '';
    return matches[0]?.span;
}
