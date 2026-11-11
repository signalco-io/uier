import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewScreenshot } from '@/src/lib/review/routes';

export const GET = reviewApiHandler<{ projectId: string; id: string; itemId: string }>(getReviewScreenshot);
export const OPTIONS = reviewPreflight('GET');
