import { Suspense } from 'react';
import { ProofViewer } from '@/src/components/app/proofs/ProofViewer';

async function Review({ params, searchParams }: PageProps<'/proof/[projectId]/[assetId]'>) {
    const [{ projectId, assetId }, { version, thread }] = await Promise.all([params, searchParams]);
    return <ProofViewer key={`${projectId}/${assetId}`} projectId={projectId} assetId={assetId}
        initialVersionId={typeof version === 'string' ? version : undefined} initialThreadId={typeof thread === 'string' ? thread : undefined} />;
}

export default function Page(props: PageProps<'/proof/[projectId]/[assetId]'>) {
    return <Suspense><Review {...props} /></Suspense>;
}
