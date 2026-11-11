import { Suspense } from 'react';
import { StatusPage } from '@/src/components/StatusPage';
import ReviewLinkUnavailable from '../review/[projectId]/not-found';

export default function UnavailableReviewContent() {
    return <Suspense fallback={<StatusPage code="404" title="This review link is unavailable" note="Nothing to open here."
        description="The project or comment may be gone, its original site address may have been removed, or you may no longer have access."
        actions={null} />}><ReviewLinkUnavailable /></Suspense>;
}
