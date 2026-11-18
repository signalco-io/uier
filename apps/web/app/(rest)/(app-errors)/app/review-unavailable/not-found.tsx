import { Suspense } from 'react';
import { StatusPageOutline } from '@/src/components/StatusPage';
import { AppLanguage } from '@/src/components/app/AppLanguage';
import ReviewLinkUnavailable from '../../../(app)/app/review/[projectId]/not-found';

export default function UnavailableReviewContent() {
    return <Suspense fallback={<StatusPageOutline />}><AppLanguage><ReviewLinkUnavailable /></AppLanguage></Suspense>;
}
