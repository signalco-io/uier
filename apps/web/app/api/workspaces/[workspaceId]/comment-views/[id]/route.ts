import { workspaceCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';

export const GET = workspaceCommentViewHandler<{ workspaceId: string; id: string }>('get');
export const PATCH = workspaceCommentViewHandler<{ workspaceId: string; id: string }>('update');
export const DELETE = workspaceCommentViewHandler<{ workspaceId: string; id: string }>('delete');

