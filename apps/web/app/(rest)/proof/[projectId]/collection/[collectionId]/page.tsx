import { Suspense } from 'react';
import { ProofCollectionReview } from '@/src/components/app/proofs/ProofCollectionReview';

async function Collection({ params }: PageProps<'/proof/[projectId]/collection/[collectionId]'>) {
    const { projectId, collectionId } = await params;
    return <ProofCollectionReview key={`${projectId}/${collectionId}`} projectId={projectId} collectionId={collectionId} />;
}

export default function Page(props: PageProps<'/proof/[projectId]/collection/[collectionId]'>) {
    return <Suspense><Collection {...props} /></Suspense>;
}
