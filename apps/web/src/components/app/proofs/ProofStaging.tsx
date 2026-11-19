'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import { stagingApiPath, type StagingPairing } from '@/src/lib/proofs/stagingModel';
import { proofFetch, proofWrite } from './client';

type Pairings = { eligible: boolean; sites: string[]; pairs: (StagingPairing & { canRevoke: boolean })[] };
type DiscrepancyPage = { threads: { id: string; number?: number; href: string }[]; next: string | null };

function Discrepancies({ path }: { path: string }) {
    const { t } = useAppI18n();
    const [page, setPage] = useState<DiscrepancyPage>();
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        void proofFetch<DiscrepancyPage>(path, { signal: abort.signal }).then(value => {
            if (!abort.signal.aborted) setPage(value);
        }, () => {
            if (!abort.signal.aborted) setFailed(true);
        });
        return () => abort.abort();
    }, [path]);
    async function more() {
        if (!page?.next) return;
        setBusy(true);
        try {
            const result = await proofFetch<DiscrepancyPage>(path + '?' + new URLSearchParams({ before: page.next, limit: '20' }));
            setPage({ threads: [...page.threads, ...result.threads], next: result.next });
        } catch { setFailed(true); }
        finally { setBusy(false); }
    }
    return <>
        {Boolean(page?.threads.length) && <ul aria-label={t('Staging discrepancies')} className="m-0 flex list-none flex-wrap gap-3 p-0">
            {page?.threads.map(comment => <li key={comment.id}><a className="inline-flex min-h-11 items-center underline" href={comment.href}>
                {t('Discrepancy #{number}', { number: comment.number ?? comment.id })}
            </a></li>)}
        </ul>}
        {page?.next && <Button size="sm" variant="ghost" disabled={busy} onClick={more}>{t('Load more discrepancies')}</Button>}
        {failed && <p role="status" className="m-0 text-sm text-muted-foreground">{t('Staging discrepancies are unavailable.')}</p>}
    </>;
}

export function ProofStaging({ projectId, assetId, versionId, surfaceId, initiallyExpanded }: { projectId: string; assetId: string; versionId: string; surfaceId: string; initiallyExpanded: boolean }) {
    const { t } = useAppI18n();
    const endpoint = stagingApiPath(projectId);
    const [expanded, setExpanded] = useState(initiallyExpanded);
    const [result, setResult] = useState<Pairings>();
    const [url, setUrl] = useState('');
    const [width, setWidth] = useState('1440');
    const [height, setHeight] = useState('900');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [loadingFailed, setLoadingFailed] = useState(false);
    const [reload, setReload] = useState(0);
    const attempt = useRef<{ key: string; requestId: string } | null>(null);
    const query = new URLSearchParams({ assetId, versionId, surfaceId }).toString();
    useEffect(() => {
        if (!expanded) return;
        const abort = new AbortController();
        setLoadingFailed(false);
        void proofFetch<Pairings>(endpoint + '?' + query, { signal: abort.signal }).then(value => {
            if (!abort.signal.aborted) setResult(value);
        }, () => {
            if (!abort.signal.aborted) setLoadingFailed(true);
        });
        return () => abort.abort();
    }, [endpoint, expanded, query, reload]);

    async function save() {
        const payload = { assetId, versionId, surfaceId, url, width: Number(width), height: Number(height) };
        const key = JSON.stringify(payload);
        if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
        setBusy(true);
        setFailed(false);
        try {
            await proofWrite<StagingPairing>(endpoint, 'POST', { ...payload, requestId: attempt.current.requestId });
            setUrl('');
            setReload(current => current + 1);
        } catch { setFailed(true); }
        finally { setBusy(false); }
    }

    async function revoke(pairingId: string) {
        setBusy(true);
        setFailed(false);
        try {
            await proofWrite(`${endpoint}/${pairingId}`, 'DELETE');
            setResult(current => current && { ...current, pairs: current.pairs.filter(pair => pair.pairingId !== pairingId) });
        } catch { setFailed(true); }
        finally { setBusy(false); }
    }

    return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="min-w-0 rounded-xl border bg-background p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('Design to staging')}</summary>
        {expanded && <div className="grid gap-3">
            {loadingFailed ? <p role="status" className="m-0">{t('Staging review is unavailable.')}</p>
                : !result ? <p role="status" className="m-0">{t('Loading…')}</p>
                    : !result.eligible ? <p className="m-0 text-sm text-muted-foreground">{t('Approve this version to pair it with staging.')}</p>
                        : !result.sites.length ? <p className="m-0 text-sm text-muted-foreground">{t('Add a site address to the project to pair this design.')}</p>
                            : <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
                                <label className="grid gap-1 text-sm">{t('Staging page URL')}
                                    <Input type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={busy}
                                        placeholder={result.sites[0]} required maxLength={2048} className="pointer-coarse:min-h-11" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="grid gap-1 text-sm">{t('Viewport width (px)')}
                                        <Input type="number" value={width} onChange={event => setWidth(event.target.value)} disabled={busy} required min={240} max={2560} className="pointer-coarse:min-h-11" />
                                    </label>
                                    <label className="grid gap-1 text-sm">{t('Viewport height (px)')}
                                        <Input type="number" value={height} onChange={event => setHeight(event.target.value)} disabled={busy} required min={240} max={2560} className="pointer-coarse:min-h-11" />
                                    </label>
                                </div>
                                <Button type="submit" disabled={busy} className="justify-self-start pointer-coarse:min-h-11">{t('Pair with staging')}</Button>
                            </form>}
            {failed && <p role="alert" className="m-0 text-sm text-destructive">{t('Could not save the pairing. Check the project address and approval.')}</p>}
            {result?.pairs.map(pair => {
                const path = `${endpoint}/${pair.pairingId}`;
                return <div key={pair.pairingId} className="grid gap-1 rounded-lg border p-2">
                    <span className="break-all font-mono text-xs">{pair.url}</span>
                    <span className="text-sm text-muted-foreground">{pair.width} × {pair.height}</span>
                    <div className="flex flex-wrap gap-2">
                        <a className={buttonVariants({ variant: 'outline', className: 'pointer-coarse:min-h-11' })} href={path + '/open'}>{t('Open paired live review')}</a>
                        {pair.canRevoke && <Button variant="ghost" disabled={busy} onClick={() => revoke(pair.pairingId)} className="pointer-coarse:min-h-11">{t('Revoke pairing')}</Button>}
                    </div>
                    <Discrepancies path={path + '/threads'} />
                </div>;
            })}
        </div>}
    </details>;
}
