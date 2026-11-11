import { reviewCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';
import { reviewPreflight } from '@/src/lib/review/http';

export const POST = reviewCommentViewHandler<{ projectId: string }>('linkCreate');
export const OPTIONS = reviewPreflight('POST, OPTIONS');

