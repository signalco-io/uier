import { workspaceCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';

export const POST = workspaceCommentViewHandler<{ workspaceId: string; id: string }>('duplicate');

