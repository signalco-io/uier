import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { attachReviewRecording, readReviewRecording } from '@/src/lib/recordings/routes';
export const GET = reviewApiHandler<{ projectId: string; id: string; itemId?: string }>(readReviewRecording);
// A finalized recording for a saved comment that has none: its author or an admin
export const POST = reviewApiHandler<{ projectId: string; id: string }>(attachReviewRecording);
export const OPTIONS = reviewPreflight('GET, POST');
