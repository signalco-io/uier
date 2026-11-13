import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { completeReviewRecording } from '@/src/lib/recordings/routes';
export const POST = reviewApiHandler<{ projectId: string; id: string; itemId?: string }>(completeReviewRecording);
export const OPTIONS = reviewPreflight('POST');
