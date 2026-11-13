import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { readReviewRecording } from '@/src/lib/recordings/routes';
export const GET = reviewApiHandler<{ projectId: string; id: string; itemId?: string }>(readReviewRecording);
export const OPTIONS = reviewPreflight('GET');
