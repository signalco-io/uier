import { reviewCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';
import { reviewPreflight } from '@/src/lib/review/http';

export const GET = reviewCommentViewHandler<{ projectId: string }>('list');
export const POST = reviewCommentViewHandler<{ projectId: string }>('create');
export const OPTIONS = reviewPreflight('GET, POST, OPTIONS');

