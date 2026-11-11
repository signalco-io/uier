import { reviewCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';
import { reviewPreflight } from '@/src/lib/review/http';

export const GET = reviewCommentViewHandler<{ projectId: string; id: string }>('get');
export const PATCH = reviewCommentViewHandler<{ projectId: string; id: string }>('update');
export const DELETE = reviewCommentViewHandler<{ projectId: string; id: string }>('delete');
export const OPTIONS = reviewPreflight('GET, PATCH, DELETE, OPTIONS');

