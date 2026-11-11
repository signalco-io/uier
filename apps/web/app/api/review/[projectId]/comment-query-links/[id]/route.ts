import { reviewCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';
import { reviewPreflight } from '@/src/lib/review/http';

export const GET = reviewCommentViewHandler<{ projectId: string; id: string }>('linkGet');
export const OPTIONS = reviewPreflight('GET, OPTIONS');

