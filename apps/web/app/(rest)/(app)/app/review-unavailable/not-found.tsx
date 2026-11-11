import { Suspense } from 'react';
import { PageLoading } from '@/src/components/app/PageLoading';
import ReviewLinkUnavailable from '../review/[projectId]/not-found';

export default function UnavailableReviewContent() {
    return <Suspense fallback={<PageLoading />}><ReviewLinkUnavailable /></Suspense>;
}
