import { workspaceCommentViewHandler } from '@/src/lib/commentQuery/viewRoutes';

export const GET = workspaceCommentViewHandler<{ workspaceId: string; id: string }>('linkGet');

