import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { readReviewComment, unreadReviewComment } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
export const POST = reviewApiHandler<{ projectId: string; id: string }>(readReviewComment);
export const DELETE = reviewApiHandler<{ projectId: string; id: string }>(unreadReviewComment);
export const OPTIONS = reviewPreflight('POST, DELETE');
