import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { startReviewRecording } from '@/src/lib/recordings/routes';
export const POST = reviewApiHandler<{ projectId: string }>(startReviewRecording);
export const OPTIONS = reviewPreflight('POST');
