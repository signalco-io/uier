'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Mark } from '@uier/brand';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, EyeIcon, EyeOffIcon, LinkIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import {
    proofApiPath, proofCollectionPath, proofViewerPath, type ProofAssetDetail, type ProofSurface, type ProofVersion
} from '@/src/lib/proofs/model';
import type { ProofAnchor, ProofPoint, ProofThread, ProofThreadLocation, ProofVerificationEvidence } from '@/src/lib/proofs/threadModel';
import { KnownPageLinks } from '@/src/knownPages';
import { clamp, type ReviewTool } from './coordinates';
import { exchangeProofLink, proofFetch, ProofRequestError } from './client';
import { mediaSurface, proofSize, type VideoPosition } from './ProofMedia';
import { ProofSelect } from './ProofSelect';
import { ProofThreads } from './ProofThreads';
import { ProofStaging } from './ProofStaging';
import { ProofApprovalPanel } from './ProofApprovalPanel';
import { ProofViewport, type ProofFocus, type SynchronizedCenter } from './ProofViewport';
import type { PdfDocument } from './PdfProof';

const PdfSearch = dynamic(() => import('./PdfProof').then(module => module.PdfSearch), { ssr: false });
const PdfThumbnail = dynamic(() => import('./PdfProof').then(module => module.PdfThumbnail), { ssr: false });

type ReviewUrlState = { version?: string; thread?: string; surface?: string };
type Compare = { versionId: string; index?: number; evidence?: ProofThreadLocation };
type Scene = { versionId: string; index: number };

const tools: { value: ReviewTool; label: string }[] = [
    { value: 'browse', label: 'Browse' }, { value: 'pan', label: 'Pan' }, { value: 'point', label: 'Point pin' },
    { value: 'region', label: 'Region pin' }, { value: 'drawing', label: 'Draw' }, { value: 'text', label: 'Quote text' }
];

function figmaSource(url: string | undefined) {
    if (!url) return;
    try {
        const value = new URL(url);
        if (value.protocol === 'https:' && /^(?:www\.)?figma\.com$/.test(value.hostname) && !value.username && !value.password) return value.href;
    } catch { /* A source link is optional. */ }
}

function matchPdfSurface(source: ProofSurface[], active: ProofSurface | undefined, reference: ProofSurface[] | undefined) {
    const signature = (surface: ProofSurface) => surface.contentDigest ?? surface.textDigest;
    const digest = active && signature(active);
    if (!digest || !reference?.some(surface => signature(surface))) return undefined;
    if (source.filter(surface => signature(surface) === digest).length !== 1) return null;
    const matches = reference.flatMap((surface, index) => signature(surface) === digest ? [index] : []);
    return matches.length === 1 ? matches[0]! : null;
}

function locationIndex(version: ProofVersion, anchor: ProofAnchor) {
    if (!('surfaceId' in anchor) || anchor.surfaceId === undefined) return 0;
    return version.manifest?.surfaces.findIndex(surface => surface.id === anchor.surfaceId) ?? -1;
}

function useProofVersion(projectId: string, assetId: string, version: string | undefined, retry: number) {
    const endpoint = `${proofApiPath(projectId)}/assets/${encodeURIComponent(assetId)}`;
    const [auth, setAuth] = useState<{ retry: number; ok: boolean }>();
    const [result, setResult] = useState<{ key: string; detail?: ProofAssetDetail; error?: string }>();
    useEffect(() => {
        let active = true;
        exchangeProofLink(projectId).then(
            () => { if (active) setAuth({ retry, ok: true }); },
            () => { if (active) setAuth({ retry, ok: false }); }
        );
        return () => { active = false; };
    }, [projectId, retry]);

    const key = version ? `${endpoint}?version=${encodeURIComponent(version)}` : endpoint;
    const authorized = auth?.retry === retry && auth.ok;
    useEffect(() => {
        if (!authorized) return;
        const controller = new AbortController();
        proofFetch<ProofAssetDetail>(key, { signal: controller.signal }).then(
            detail => { if (!controller.signal.aborted) setResult({ key, detail }); },
            error => {
                if (!controller.signal.aborted) setResult({ key, error: error instanceof ProofRequestError && error.status === 404
                    ? 'This review link is unavailable.' : 'The file could not be loaded.' });
            }
        );
        return () => controller.abort();
    }, [authorized, key, retry]);
    return {
        endpoint,
        // Making the current immutable version explicit in a permalink does not blank the canvas.
        detail: result?.key === key || (version !== undefined && result?.detail?.version?.id === version) ? result?.detail : undefined,
        previous: result?.detail,
        error: auth?.retry === retry && !auth.ok ? 'This review link is unavailable.' : result?.key === key ? result.error : undefined
    };
}

export function ProofViewer({ projectId, assetId, initialVersionId, initialThreadId, initialSurfaceId }: {
    projectId: string; assetId: string; initialVersionId?: string; initialThreadId?: string; initialSurfaceId?: string;
}) {
    const { t, language } = useAppI18n();
    const [address, setAddress] = useState<ReviewUrlState>({ version: initialVersionId, thread: initialThreadId, surface: initialSurfaceId });
    const [deepLink, setDeepLink] = useState<ReviewUrlState | undefined>(initialThreadId ? { version: initialVersionId, thread: initialThreadId } : undefined);
    const [retry, setRetry] = useState(0);
    const { endpoint, detail, previous, error } = useProofVersion(projectId, assetId, address.version, retry);
    const [scene, setScene] = useState<Scene>();
    const [focus, setFocus] = useState<ProofFocus & { versionId: string }>();
    const [zoom, setZoom] = useState<number | 'fit'>('fit');
    const [tool, setTool] = useState<ReviewTool>('browse');
    const [pins, setPins] = useState(true);
    const [draftAnchor, setDraftAnchor] = useState<ProofAnchor>();
    const [threads, setThreads] = useState<ProofThread[]>([]);
    const [comparison, setComparison] = useState<Compare>();
    const [compareMode, setCompareMode] = useState<'side' | 'overlay'>('side');
    const [opacity, setOpacity] = useState(50);
    const [center, setCenter] = useState<SynchronizedCenter>();
    const [emailWidth, setEmailWidth] = useState('wide');
    const [pdf, setPdf] = useState<{ version: string; document: PdfDocument }>();
    const [referencePdf, setReferencePdf] = useState<{ version: string; document: PdfDocument }>();
    const [text, setText] = useState<{ key: string; value: string }>();
    const [referenceText, setReferenceText] = useState<{ key: string; value: string }>();
    const [autoPair, setAutoPair] = useState<{ key: string; index: number | null }>();
    const [videoSync, setVideoSync] = useState<VideoPosition>();
    const [copied, setCopied] = useState(false);
    const [notice, setNotice] = useState('');
    const [authorizedCollection, setAuthorizedCollection] = useState<string>();
    const [choosingEvidence, setChoosingEvidence] = useState(false);
    const threadPanel = useRef<HTMLElement>(null);
    const gestureNumber = useRef(0);
    const currentTime = useRef(0);
    const collectionId = detail?.asset.collectionId ?? undefined;
    const canManage = detail?.permissions.manage === true;
    useEffect(() => {
        if (canManage || !collectionId) return;
        const controller = new AbortController();
        void proofFetch(proofApiPath(projectId) + '?' + new URLSearchParams({ collection: collectionId }), { signal: controller.signal })
            .then(() => { if (!controller.signal.aborted) setAuthorizedCollection(collectionId); },
                () => { if (!controller.signal.aborted) setAuthorizedCollection(undefined); });
        return () => controller.abort();
    }, [canManage, collectionId, projectId, retry]);

    const version = detail?.version;
    const versionId = version?.id;
    const format = version?.manifest?.format;
    const surfaces = version?.manifest?.surfaces ?? [];
    const currentFocus = focus?.versionId === versionId ? focus : undefined;
    const index = scene && scene.versionId === versionId ? scene.index : Math.max(0, surfaces.findIndex(surface => surface.id === address.surface));
    const activeSurface = version ? mediaSurface(version, index) : undefined;
    const sourceUrl = format === 'figma' && detail?.permissions.manage ? figmaSource(activeSurface?.sourceUrl) : undefined;
    const reference = detail?.versions.find(item => item.id === comparison?.versionId && item.id !== versionId && item.status === 'published');
    const published = detail?.versions.filter(item => item.status === 'published') ?? [];
    const emailPixels = emailWidth === 'wide' ? 800 : 375;
    const document = pdf?.version === versionId ? pdf?.document : undefined;
    const referenceDocument = referencePdf && referencePdf.version === reference?.id ? referencePdf.document : undefined;
    const matchKey = `${versionId}:${index}:${reference?.id}`;
    const manifestPair = format === 'pdf' ? matchPdfSurface(surfaces, activeSurface, reference?.manifest?.surfaces) : undefined;
    const pairIndex = manifestPair === undefined && autoPair?.key === matchKey ? autoPair.index : manifestPair;
    const matchingFrame = activeSurface && reference?.manifest?.surfaces.findIndex(surface => surface.id === activeSurface.id);
    const refIsEarlier = (reference?.number ?? 0) < (version?.number ?? 0);
    const referenceIndex = comparison?.evidence && reference
        ? locationIndex(reference, comparison.evidence.anchor)
        : comparison?.index ?? (format === 'pdf' ? pairIndex ?? 0 : format === 'figma' && reference?.manifest?.format === 'figma' ? matchingFrame ?? -1 : 0);
    const textKey = `${versionId}:${index}`;
    const referenceTextKey = `${reference?.id}:${referenceIndex}`;
    const canComment = detail?.permissions.comment === true;
    const base = version && proofSize(version, index, emailPixels);
    const pairedSize = reference && proofSize(reference, referenceIndex, emailPixels);
    const canOverlay = Boolean(base && pairedSize && referenceIndex >= 0 && ['image', 'pdf', 'figma'].includes(format ?? '')
        && reference?.manifest?.format === format && Math.abs(base.width / base.height / (pairedSize.width / pairedSize.height) - 1) < 0.025);
    const overlay = compareMode === 'overlay' && canOverlay && reference ? { version: reference, index: referenceIndex, opacity: opacity / 100 } : undefined;

    const changeAddress = useCallback((next: ReviewUrlState, replace = false) => {
        const url = proofViewerPath(projectId, assetId, next.version);
        const query = new URLSearchParams();
        if (next.thread) query.set('thread', next.thread);
        if (next.surface) query.set('surface', next.surface);
        const href = query.size ? url + (next.version ? '&' : '?') + query : url;
        if (href !== location.pathname + location.search) {
            if (replace) history.replaceState(null, '', href);
            else history.pushState(null, '', href);
        }
        setAddress(next);
    }, [projectId, assetId]);

    useEffect(() => {
        const pop = () => {
            const params = new URLSearchParams(window.location.search);
            const next = { version: params.get('version') ?? undefined, thread: params.get('thread') ?? undefined, surface: params.get('surface') ?? undefined };
            setAddress(next);
            setDeepLink(next.thread ? next : undefined);
            setFocus(undefined);
            setDraftAnchor(undefined);
            setScene(undefined);
            setComparison(undefined);
        };
        window.addEventListener('popstate', pop);
        return () => window.removeEventListener('popstate', pop);
    }, []);

    const showLocation = useCallback((target: ProofThreadLocation, version: ProofVersion) => {
        const index = locationIndex(version, target.anchor);
        if (index < 0) {
            setNotice('The saved location is unavailable on this version.');
            return;
        }
        setNotice('');
        setScene({ versionId: target.versionId, index });
        setFocus({ versionId: target.versionId, anchor: target.anchor, nonce: ++gestureNumber.current });
        setDraftAnchor(undefined);
        setTool('browse');
    }, []);

    useEffect(() => {
        if (!deepLink?.thread || !detail?.version) return;
        const controller = new AbortController();
        const current = detail.version;
        const url = `${endpoint}/threads/${encodeURIComponent(deepLink.thread)}?` + new URLSearchParams({ version: current.id });
        void proofFetch<{ thread: ProofThread }>(url, { signal: controller.signal }).then(({ thread }) => {
            if (controller.signal.aborted) return;
            const selected = detail.versions.find(item => item.id === thread.location.versionId);
            if (selected) {
                showLocation(thread.location, selected);
                if (current.id !== selected.id) changeAddress({ version: selected.id, thread: thread.id }, true);
            }
            setDeepLink(undefined);
        }).catch(() => { if (!controller.signal.aborted) setDeepLink(undefined); });
        return () => controller.abort();
    }, [changeAddress, deepLink, detail, endpoint, showLocation]);

    const openLocation = useCallback((target: ProofThreadLocation) => {
        const selected = detail?.versions.find(item => item.id === target.versionId);
        if (!selected) { setNotice('The saved version is unavailable.'); return; }
        showLocation(target, selected);
        const selectedThread = new URLSearchParams(window.location.search).get('thread') ?? undefined;
        changeAddress({ version: selected.id, thread: selectedThread }, true);
    }, [changeAddress, detail?.versions, showLocation]);

    const selectThread = useCallback((threadId: string) => {
        setDraftAnchor(undefined);
        setCopied(false);
        changeAddress({ version: address.version ?? versionId, thread: threadId }, true);
    }, [address.version, changeAddress, versionId]);

    const pickPin = (thread: ProofThread) => {
        selectThread(thread.id);
        openLocation(thread.location);
        threadPanel.current?.focus({ preventScroll: true });
        if (matchMedia('(width < 1024px)').matches) threadPanel.current?.scrollIntoView({ block: 'start' });
    };

    const openEvidence = (evidence: ProofVerificationEvidence, side: 'before' | 'after') => {
        if (evidence.assetId !== assetId) return;
        const alternate = evidence[side === 'before' ? 'after' : 'before'];
        setComparison({ versionId: alternate.versionId, evidence: alternate });
        setCompareMode('side');
        setCenter(undefined);
        openLocation(evidence[side]);
    };

    const changeVersion = (id: string, preferredAnchor?: ProofAnchor) => {
        const next = published.find(item => item.id === id);
        setFocus(undefined);
        setDraftAnchor(undefined);
        setScene(undefined);
        setNotice('');
        if (next && preferredAnchor) showLocation({ versionId: id, anchor: preferredAnchor }, next);
        changeAddress({ version: id, thread: address.thread });
    };

    const selectPage = (page: number) => {
        if (!version || page < 0 || page >= surfaces.length) return;
        setScene({ versionId: version.id, index: page });
        setFocus(undefined);
        setDraftAnchor(undefined);
        if (comparison && !comparison.evidence) setComparison({ versionId: comparison.versionId });
    };

    const chooseAnchor = (anchor: ProofAnchor) => {
        if (version && 'surfaceId' in anchor && anchor.surfaceId !== activeSurface?.id) {
            const page = locationIndex(version, anchor);
            if (page >= 0) setScene({ versionId: version.id, index: page });
        }
        setDraftAnchor(anchor);
        setTool('browse');
        setChoosingEvidence(false);
    };

    function requestTarget() {
        setChoosingEvidence(true);
        setDraftAnchor(undefined);
        if (detail?.asset.currentVersionId && versionId !== detail.asset.currentVersionId) changeVersion(detail.asset.currentVersionId);
        setTool('point');
    }

    const saveDocument = useCallback((value: PdfDocument) => {
        if (versionId) setPdf({ version: versionId, document: value });
    }, [versionId]);
    const saveReferenceDocument = useCallback((value: PdfDocument) => {
        if (reference?.id) setReferencePdf({ version: reference.id, document: value });
    }, [reference?.id]);
    const saveText = useCallback((value: string) => setText({ key: textKey, value }), [textKey]);
    const saveReferenceText = useCallback((value: string) => setReferenceText({ key: referenceTextKey, value }), [referenceTextKey]);
    const syncCenter = useCallback((point: ProofPoint, from: SynchronizedCenter['from']) => {
        setCenter({ point, from, nonce: ++gestureNumber.current });
    }, []);

    useEffect(() => {
        if (manifestPair !== undefined || !document || !referenceDocument || comparison?.evidence || comparison?.index !== undefined) return;
        let canceled = false;
        void uniquePdfPage(document, index + 1, referenceDocument).then(number => {
            if (!canceled) setAutoPair({ key: matchKey, index: number === null ? null : number - 1 });
        }).catch(() => { if (!canceled) setAutoPair({ key: matchKey, index: null }); });
        return () => { canceled = true; };
    }, [comparison?.evidence, comparison?.index, document, index, manifestPair, matchKey, referenceDocument]);

    const display = detail ?? previous;
    const threadVersion = version ?? previous?.version;
    const versionLabel = (item: ProofVersion) => t('Version {number}', { number: item.number === null ? '–' : new Intl.NumberFormat(language).format(item.number) });
    const surfaceLabel = (item: ProofVersion, surface: number) => {
        const label = mediaSurface(item, surface)?.label;
        return item.manifest?.format === 'pdf' ? t('Page {number}', { number: label ?? surface + 1 })
            : label ?? t('Frame {number}', { number: surface + 1 });
    };
    const surfaceItems = (item: ProofVersion) => item.manifest?.surfaces.map((_, index) => ({ value: String(index), label: surfaceLabel(item, index) })) ?? [];
    const moveZoom = (delta: number) => setZoom(current => current === 'fit' ? (delta > 0 ? 1 : 0.5) : clamp(Math.round((current + delta) * 100) / 100, 0.1, 4));
    const referenceFocus = comparison?.evidence && reference ? { anchor: comparison.evidence.anchor, nonce: currentFocus?.nonce ?? 0 } : undefined;

    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-[112rem] flex-col gap-4 px-3 py-4 sm:px-6"
            onKeyDown={event => {
                if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="region"]')) return;
                if (event.key === '+' || event.key === '=') moveZoom(0.25);
                if (event.key === '-') moveZoom(-0.25);
                if (event.key === '0') setZoom('fit');
                if (event.key === 'PageUp' || event.key === 'PageDown') {
                    event.preventDefault();
                    selectPage(index + (event.key === 'PageUp' ? -1 : 1));
                }
            }}>
            <header className="flex min-w-0 flex-wrap items-center gap-3 border-b pb-3">
                <Mark className="size-7 shrink-0" />
                <h1 className="m-0 min-w-0 flex-1 break-words text-lg font-semibold sm:text-xl">{display?.asset.name ?? t('File review')}</h1>
                {detail?.permissions.manage && <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    href={KnownPageLinks.projectFiles(projectId)}>{t('Files')}</Link>}
                {collectionId && (canManage || authorizedCollection === collectionId) &&
                    <Link className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={proofCollectionPath(projectId, collectionId)}>{t('Collection')}</Link>}
                {version?.originalUrl && detail?.permissions.downloadOriginal &&
                    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={version.originalUrl} download><DownloadIcon data-icon="inline-start" />{t('Download original')}</a>}
                {version && <Button variant="outline" size="sm" onClick={() => {
                    const url = new URL(proofViewerPath(projectId, assetId, version.id), location.origin);
                    if (address.thread) url.searchParams.set('thread', address.thread);
                    void navigator.clipboard.writeText(url.href).then(() => { setCopied(true); setNotice(''); }, () => setNotice('The link could not be copied.'));
                }}><LinkIcon data-icon="inline-start" />{t(copied ? 'Copied' : 'Copy permalink')}</Button>}
            </header>
            {error && <div className="grid justify-items-start gap-2">
                <p role="alert" className="m-0 text-destructive">{t(error)}</p>
                <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</Button>
            </div>}
            {!detail && !error && <p role="status" className="m-0 text-muted-foreground">{t('Loading preview…')}</p>}
            {detail && !version && <p role="status" className="m-0 text-muted-foreground">{t('No published version')}</p>}
            {!error && threadVersion && <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                <section aria-label={t('Preview')} className="flex min-w-0 flex-col gap-3">
                    {version && <>
                        <div className="flex flex-wrap items-center gap-2">
                            <ProofSelect label={t('Version')} value={version.id}
                                items={published.map(item => ({ value: item.id, label: versionLabel(item) }))}
                                onChange={id => changeVersion(id)} />
                            {version.id !== detail?.asset.currentVersionId && detail?.asset.currentVersionId &&
                                <Button size="sm" variant="ghost" onClick={() => changeVersion(detail.asset.currentVersionId!)}>{t('Open latest version')}</Button>}
                            {published.length > 1 && <ProofSelect label={t('Compare with')} value={reference?.id ?? 'none'}
                                items={[{ value: 'none', label: t('Compare versions') }, ...published.filter(item => item.id !== version.id).map(item => ({ value: item.id, label: versionLabel(item) }))]}
                                onChange={id => {
                                    setComparison(id === 'none' ? undefined : { versionId: id });
                                    setCompareMode('side');
                                    setCenter(undefined);
                                }} />}
                            {canOverlay && <ProofSelect label={t('Comparison layout')} value={compareMode}
                                items={[{ value: 'side', label: t('Side by side') }, { value: 'overlay', label: t('Overlay') }]}
                                onChange={mode => setCompareMode(mode === 'overlay' ? 'overlay' : 'side')} />}
                            {overlay && <label className="flex items-center gap-2 text-sm">
                                {t('Opacity')} <Input type="range" min={0} max={100} value={opacity} onChange={event => setOpacity(Number(event.target.value))} className="w-28" />
                            </label>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-1.5">
                            {surfaces.length > 1 && <>
                                <Button aria-label={t('Previous page or frame')} variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => selectPage(index - 1)}><ChevronLeftIcon /></Button>
                                <ProofSelect label={t('Page or frame')} value={String(index)} items={surfaceItems(version)} onChange={value => selectPage(Number(value))} />
                                <Button aria-label={t('Next page or frame')} variant="ghost" size="icon-sm" disabled={index === surfaces.length - 1} onClick={() => selectPage(index + 1)}><ChevronRightIcon /></Button>
                            </>}
                            {sourceUrl && <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={sourceUrl}
                                target="_blank" rel="noreferrer noopener">{t('Open in Figma')}</a>}
                            {format !== 'email' && <>
                                <Button variant="ghost" size="icon-sm" aria-label={t('Zoom out')} onClick={() => moveZoom(-0.25)} disabled={zoom === 0.1}><MinusIcon /></Button>
                                <ProofSelect label={t('Zoom')} value={String(zoom)} items={[
                                    { value: 'fit', label: t('Fit') },
                                    ...[...new Set([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, ...(zoom === 'fit' ? [] : [zoom])])].sort((a, b) => a - b)
                                        .map(value => ({ value: String(value), label: new Intl.NumberFormat(language, { style: 'percent' }).format(value) }))
                                ]} onChange={value => setZoom(value === 'fit' ? 'fit' : Number(value))} />
                                <Button variant="ghost" size="icon-sm" aria-label={t('Zoom in')} onClick={() => moveZoom(0.25)} disabled={zoom === 4}><PlusIcon /></Button>
                            </>}
                            {format === 'email' && <ProofSelect label={t('Email viewport')} value={emailWidth}
                                items={[{ value: 'wide', label: t('Wide') }, { value: 'narrow', label: t('Narrow') }]} onChange={setEmailWidth} />}
                            <ProofSelect label={t('Review tool')} value={tool} items={tools.filter(option => option.value === 'browse' || option.value === 'pan'
                                || (canComment && Boolean(activeSurface) && (option.value !== 'text' || format === 'pdf'))).map(option => ({ ...option, label: t(option.label) }))}
                                onChange={value => setTool(value as ReviewTool)} />
                            <Button size="icon-sm" variant="ghost" aria-pressed={!pins} aria-label={t(pins ? 'Hide pins' : 'Show pins')} onClick={() => setPins(value => !value)}>
                                {pins ? <EyeOffIcon /> : <EyeIcon />}
                            </Button>
                            {draftAnchor && <Button variant="ghost" size="sm" onClick={() => setDraftAnchor(undefined)}>{t('Clear selection')}</Button>}
                            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => {
                                threadPanel.current?.focus({ preventScroll: true });
                                threadPanel.current?.scrollIntoView({ block: 'start' });
                            }}>{t('Comments')}</Button>
                        </div>
                        {choosingEvidence && <p role="status" className="m-0 text-sm text-muted-foreground">{t('Choose the revised detail on the file.')}</p>}
                        {tool === 'text' && <p className="m-0 text-sm text-muted-foreground">{t('Select text on the PDF to quote it.')}</p>}
                        {tool !== 'browse' && tool !== 'pan' && tool !== 'text' &&
                            <p className="m-0 text-sm text-muted-foreground">{t('Mark the file, or focus the preview and use the arrow keys and Enter.')}</p>}
                        {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{t(notice)}</p>}
                        <div className={reference && !overlay ? 'grid min-w-0 gap-3 xl:grid-cols-2' : 'min-w-0'}>
                            <div className="grid min-w-0 gap-2">
                                {reference && <p className="m-0 text-sm font-medium">{versionLabel(version)}</p>}
                                <ProofViewport projectId={projectId} version={version} index={index} label={t('File preview')} zoom={format === 'email' ? 'fit' : zoom}
                                    emailWidth={emailPixels} tool={tool} focus={currentFocus} draftAnchor={draftAnchor} threads={threads}
                                    selectedThread={address.thread} pins={pins} onSelectThread={pickPin} onAnchor={canComment ? chooseAnchor : undefined}
                                    syncCenter={center} onCenter={reference && !overlay && !comparison?.evidence ? syncCenter : undefined}
                                    overlay={overlay} onDocument={format === 'pdf' ? saveDocument : undefined} onText={format === 'pdf' ? saveText : undefined}
                                    onTime={format === 'video' ? ms => { currentTime.current = ms; } : undefined} />
                            </div>
                            {reference && !overlay && <div className="grid min-w-0 content-start gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="m-0 text-sm font-medium">{versionLabel(reference)}</p>
                                    {(reference.manifest?.surfaces.length ?? 0) > 1 && !comparison?.evidence && <ProofSelect label={t('Reference page or frame')}
                                        value={referenceIndex < 0 ? 'unmatched' : String(referenceIndex)}
                                        items={[...(referenceIndex < 0 ? [{ value: 'unmatched', label: t('Choose a reference frame') }] : []), ...surfaceItems(reference)]}
                                        onChange={value => { if (value !== 'unmatched') setComparison({ versionId: reference.id, index: Number(value) }); }} />}
                                    {format === 'video' && reference.manifest?.format === 'video' && <Button size="sm" variant="outline"
                                        onClick={() => setVideoSync({ ms: currentTime.current, nonce: ++gestureNumber.current })}>{t('Match playback time')}</Button>}
                                </div>
                                {referenceIndex < 0 ? <p role="alert" className="m-0 rounded-lg border p-4">{t(comparison?.evidence ? 'The saved location is unavailable on this version.' : 'This frame is absent from the reference version.')}</p>
                                    : <ProofViewport projectId={projectId} version={reference} index={referenceIndex} label={t('Reference preview')} zoom={zoom} emailWidth={emailPixels}
                                        tool={tool === 'pan' ? 'pan' : 'browse'} focus={referenceFocus} pins={pins}
                                        source="reference" syncCenter={center} onCenter={comparison?.evidence ? undefined : syncCenter}
                                        onDocument={reference.manifest?.format === 'pdf' ? saveReferenceDocument : undefined}
                                        onText={reference.manifest?.format === 'pdf' ? saveReferenceText : undefined}
                                        videoPosition={videoSync} />}
                                {format === 'pdf' && pairIndex === null && comparison?.index === undefined && !comparison?.evidence &&
                                    <p role="status" className="m-0 text-sm text-muted-foreground">{t('Choose the matching reference page.')}</p>}
                            </div>}
                        </div>
                        {document && <>
                            <div aria-label={t('PDF page thumbnails')} className="flex gap-1 overflow-x-auto rounded-lg border p-1">
                                {surfaces.map((surface, page) => <PdfThumbnail key={surface.id} document={document} page={page + 1}
                                    label={surfaceLabel(version, page)} active={page === index} onClick={() => selectPage(page)} />)}
                            </div>
                            <PdfSearch key={version.id} document={document} onPage={page => selectPage(page - 1)} />
                        </>}
                        {reference && format === 'pdf' && text?.key === textKey && referenceText?.key === referenceTextKey &&
                            <PdfTextChanges before={refIsEarlier ? referenceText.value : text.value} after={refIsEarlier ? text.value : referenceText.value} />}
                    </>}
                </section>
                <div className="grid min-w-0 content-start gap-3">
                    <ProofApprovalPanel key={threadVersion.id} endpoint={endpoint} projectId={projectId} assetId={assetId}
                        versionId={threadVersion.id} number={threadVersion.number} />
                    {canManage && version && activeSurface && (format === 'image' || format === 'pdf' || format === 'figma') &&
                        <ProofStaging key={`${version.id}/${activeSurface.id}`} projectId={projectId} assetId={assetId}
                            versionId={version.id} surfaceId={activeSurface.id} initiallyExpanded={address.surface === activeSurface.id} />}
                    <aside ref={threadPanel} tabIndex={-1} aria-label={t('Comments')}
                        className="min-w-0 scroll-mt-3 rounded-xl border bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-h-[calc(100dvh-6rem)] lg:overflow-auto">
                        <ProofThreads projectId={projectId} assetId={assetId} versionId={threadVersion.id} currentVersionId={display?.asset.currentVersionId ?? null}
                            threadId={address.thread} draftAnchor={draftAnchor} onThreadSelect={selectThread} onJump={openLocation}
                            onThreadsChange={setThreads} onEvidence={openEvidence} onRequestTarget={requestTarget} />
                    </aside>
                </div>
            </div>}
        </main>
    );
}

async function uniquePdfPage(source: PdfDocument, page: number, reference: PdfDocument) {
    async function pageText(document: PdfDocument, number: number) {
        const { items } = await (await document.getPage(number)).getTextContent();
        return items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim();
    }
    if (reference.numPages > 128) return null;
    const needle = await pageText(source, page);
    if (!needle) return null;
    let match: number | null = null;
    for (let number = 1; number <= reference.numPages; number++) {
        if (needle !== await pageText(reference, number)) continue;
        if (match !== null) return null;
        match = number;
    }
    return match;
}

type TextChange = { kind: 'same' | 'added' | 'removed'; words: string[] };

function pdfTextDiff(before: string, after: string): TextChange[] {
    const a = before.match(/\S+/g) ?? [];
    const b = after.match(/\S+/g) ?? [];
    let start = 0;
    let end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    const left = a.slice(start, a.length - end);
    const right = b.slice(start, b.length - end);
    const changes: TextChange[] = [];
    const append = (kind: TextChange['kind'], words: string[]) => {
        if (!words.length) return;
        const last = changes.at(-1);
        if (last?.kind === kind) {
            for (const word of words) last.words.push(word);
        } else changes.push({ kind, words });
    };
    // Context outside the change is kept short. Limit the LCS work for pages with large edits.
    append('same', a.slice(Math.max(0, start - 12), start));
    const stride = right.length + 1;
    if ((left.length + 1) * stride > 65_536) {
        append('removed', left);
        append('added', right);
    } else {
        const lengths = new Uint16Array((left.length + 1) * stride);
        for (let i = left.length - 1; i >= 0; i--) {
            for (let j = right.length - 1; j >= 0; j--) {
                lengths[i * stride + j] = left[i] === right[j] ? 1 + lengths[(i + 1) * stride + j + 1]!
                    : Math.max(lengths[(i + 1) * stride + j]!, lengths[i * stride + j + 1]!);
            }
        }
        let i = 0;
        let j = 0;
        while (i < left.length || j < right.length) {
            if (i < left.length && j < right.length && left[i] === right[j]) {
                append('same', [left[i++]!]);
                j++;
            } else if (j >= right.length || (i < left.length && lengths[(i + 1) * stride + j]! >= lengths[i * stride + j + 1]!)) {
                append('removed', [left[i++]!]);
            } else append('added', [right[j++]!]);
        }
    }
    append('same', a.slice(a.length - end, Math.min(a.length, a.length - end + 12)));
    return changes;
}

function PdfTextChanges({ before, after }: { before: string; after: string }) {
    const { t } = useAppI18n();
    if (!before && !after) return null;
    const changes = pdfTextDiff(before, after);
    return <details className="min-w-0 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t('PDF text changes')}</summary>
        {changes.every(change => change.kind === 'same')
            ? <p className="mt-2 text-sm text-muted-foreground">{t('No text changes on these pages.')}</p>
            : <p className="mt-2 max-h-48 overflow-auto break-words text-sm">
                {changes.map(({ kind, words }, index) => {
                    const text = words.join(' ');
                    return <span key={index}>
                        {kind === 'removed' ? <del aria-label={t('Removed')}>{text}</del>
                            : kind === 'added' ? <ins aria-label={t('Added')}>{text}</ins> : text}{' '}
                    </span>;
                })}
            </p>}
    </details>;
}
