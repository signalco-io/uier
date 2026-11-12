import { Suspense } from 'react';
import { PageLoading } from '@/src/components/app/PageLoading';
import { AppLanguage } from '@/src/components/app/AppLanguage';
import ReviewLinkUnavailable from '../../../(app)/app/review/[projectId]/not-found';

export default function UnavailableReviewContent() {
    return <Suspense fallback={<PageLoading />}><AppLanguage><ReviewLinkUnavailable /></AppLanguage></Suspense>;
}
