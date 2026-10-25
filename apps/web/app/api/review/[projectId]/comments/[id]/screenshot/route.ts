import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewScreenshot, replaceReviewScreenshot } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const GET = reviewApiHandler<{ projectId: string; id: string }>(getReviewScreenshot);
export const POST = reviewApiHandler<{ projectId: string; id: string }>(replaceReviewScreenshot);
export const OPTIONS = reviewPreflight('GET, POST');
