'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mark } from '@uier/brand';
import { Button } from '@/src/components/ui/button';
import { useAppI18n } from '@/src/lib/i18n/client';
import { proofApiPath, proofViewerPath, type ProofLibrary } from '@/src/lib/proofs/model';
import { exchangeProofLink, proofFetch } from './client';
import { ProofApprovalSummary, useProofApprovalSummaries } from './ProofApprovalSummary';

export function ProofCollectionReview({ projectId, collectionId }: { projectId: string; collectionId: string }) {
    const { t } = useAppI18n();
    const [result, setResult] = useState<ProofLibrary>();
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const approvals = useProofApprovalSummaries(projectId, Boolean(result), collectionId, attempt);
    useEffect(() => {
        const controller = new AbortController();
        exchangeProofLink(projectId).then(() => proofFetch<ProofLibrary>(proofApiPath(projectId) + '?' + new URLSearchParams({ collection: collectionId }), { signal: controller.signal })).then(
            result => { if (!controller.signal.aborted) setResult(result); },
            () => { if (!controller.signal.aborted) setError(true); }
        );
        return () => controller.abort();
    }, [projectId, collectionId, attempt]);
    const collection = result?.collections.find(item => item.id === collectionId);
    const assets = result?.assets.filter(asset => asset.collectionId === collectionId && asset.currentVersionId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 p-4 sm:p-8">
            <Mark className="size-7" />
            {collection ? <>
                <h1 className="m-0 break-words text-2xl font-semibold">{collection.name}</h1>
                {assets?.length ? <ul className="m-0 list-none divide-y rounded-xl border p-0">
                    {assets.map(asset => {
                        const approval = approvals?.[asset.id];
                        return <li key={asset.id} className="px-4 py-3">
                            <Link href={proofViewerPath(projectId, asset.id)} prefetch={false} className="break-words font-medium underline-offset-4 hover:underline">
                                {asset.name}
                            </Link>
                            {approval && approval.versionId === asset.currentVersionId && <ProofApprovalSummary summary={approval} />}
                        </li>;
                    })}
                </ul> : <p className="text-muted-foreground">{t('This collection is empty.')}</p>}
            </> : (error || result) ? (
                <div className="grid justify-items-start gap-3">
                    <p role="alert" className="m-0">{t('This review link is unavailable.')}</p>
                    <Button variant="outline" onClick={() => { setError(false); setResult(undefined); setAttempt(value => value + 1); }}>{t('Retry')}</Button>
                </div>
            ) : <p role="status" className="text-muted-foreground">{t('Loading files')}…</p>}
        </main>
    );
}
