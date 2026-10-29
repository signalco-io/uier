import { keyedHash } from '../../../src/lib/comments/environment';
import type { VisitorDto } from '../../../src/lib/comments/dto';
import { commentsApiHandler } from '../../../src/lib/comments/http';
import { displayName, expiredVisitorCookies } from '../../../src/lib/comments/visitor';

import { isPrivateAppFeedback } from '../../../src/lib/comments/publicProject';

// GET /api/visitor - who the toolbar's profile shows
export const GET = commentsApiHandler(async ({ visitor, request, domain }) => Response.json({
    privateAppFeedback: isPrivateAppFeedback({ domain, path: new URL(request.url).searchParams.get('path') ?? '/' }),
    name: visitor.name ?? (visitor.hasCookie ? displayName(visitor.authorId) : null),
    ...(visitor.member ? { member: true } : {}),
    draftScope: visitor.authorId ? keyedHash('draft-scope', visitor.authorId) : undefined
} satisfies VisitorDto));

// DELETE /api/visitor - signs out: removes the visitor cookie from this browser. The comments
// stay; this browser can no longer resolve or delete them. Never creates an identity.
export const DELETE = commentsApiHandler(async ({ request }) => {
    const headers = new Headers();
    for (const value of expiredVisitorCookies(request)) headers.append('Set-Cookie', value);
    return new Response(null, { status: 204, headers });
}, { createVisitor: false });
