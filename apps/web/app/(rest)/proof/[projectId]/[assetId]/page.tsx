import { Suspense } from 'react';
import { ProofReturningGate } from '@/src/components/app/proofs/ProofReturningReview';
import { ProofViewer } from '@/src/components/app/proofs/ProofViewer';

async function Review({ params, searchParams }: PageProps<'/proof/[projectId]/[assetId]'>) {
    const [{ projectId, assetId }, { version, thread, surface }] = await Promise.all([params, searchParams]);
    return <ProofReturningGate key={`${projectId}/${assetId}`} projectId={projectId} assetId={assetId}>
        <ProofViewer projectId={projectId} assetId={assetId} initialVersionId={typeof version === 'string' ? version : undefined}
            initialThreadId={typeof thread === 'string' ? thread : undefined} initialSurfaceId={typeof surface === 'string' ? surface : undefined} />
    </ProofReturningGate>;
}

export default function Page(props: PageProps<'/proof/[projectId]/[assetId]'>) {
    return <Suspense><Review {...props} /></Suspense>;
}
