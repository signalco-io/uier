import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { prioritizeReviewComment } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
export const PATCH = reviewApiHandler<{ projectId: string; id: string }>(prioritizeReviewComment);
export const OPTIONS = reviewPreflight('PATCH');
