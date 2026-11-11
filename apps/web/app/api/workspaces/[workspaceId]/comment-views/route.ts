import { workspaceCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';

export const GET = workspaceCommentViewHandler<{ workspaceId: string }>('list');
export const POST = workspaceCommentViewHandler<{ workspaceId: string }>('create');

