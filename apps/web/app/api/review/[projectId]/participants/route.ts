import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { listReviewParticipants } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
export const GET = reviewApiHandler(listReviewParticipants);
export const OPTIONS = reviewPreflight('GET');
