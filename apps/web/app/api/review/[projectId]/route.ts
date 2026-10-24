import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewInfo } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const GET = reviewApiHandler(getReviewInfo, { comments: false });
export const OPTIONS = reviewPreflight('GET');
