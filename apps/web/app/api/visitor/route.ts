import { keyedHash } from '../../../src/lib/comments/environment';
import type { VisitorDto } from '../../../src/lib/comments/dto';
import { commentsApiHandler } from '../../../src/lib/comments/http';
import { accountUserId, displayName, expiredVisitorCookies } from '../../../src/lib/comments/visitor';
import { getUser } from '../../../src/lib/app/users';
import { getWorkspace } from '../../../src/lib/app/workspaces';
import { toolbarLanguageInfo } from '../../../src/lib/app/toolbarLanguage';

import { isPrivateAppFeedback } from '../../../src/lib/comments/publicProject';

// GET /api/visitor - who the toolbar's profile shows, and the toolbar's language
export const GET = commentsApiHandler(async ({ visitor, request, domain, publicFeedback, project }) => {
    const userId = accountUserId(visitor);
    const [workspace, user] = await Promise.all([project ? getWorkspace(project.workspaceId) : null, userId ? getUser(userId) : null]);
    return Response.json({
        // An account's feedback on uier is always private; a guest's only on the app's pages
        privateAppFeedback: Boolean(publicFeedback) || isPrivateAppFeedback({ domain, path: new URL(request.url).searchParams.get('path') ?? '/' }),
        name: visitor.name ?? (visitor.hasCookie ? displayName(visitor.authorId) : null),
        ...(visitor.member ? { member: true } : {}),
        draftScope: visitor.authorId ? keyedHash('draft-scope', visitor.authorId) : undefined,
        // A signed-in account's own choice comes with it; a guest's stays in their browser
        language: toolbarLanguageInfo(workspace, project, userId ? user ?? { toolbarLanguage: undefined } : undefined)
    } satisfies VisitorDto);
});

// DELETE /api/visitor - signs out: removes the visitor cookie from this browser. The comments
// stay; this browser can no longer resolve or delete them. Never creates an identity.
export const DELETE = commentsApiHandler(async ({ request }) => {
    const headers = new Headers();
    for (const value of expiredVisitorCookies(request)) headers.append('Set-Cookie', value);
    return new Response(null, { status: 204, headers });
}, { createVisitor: false });
