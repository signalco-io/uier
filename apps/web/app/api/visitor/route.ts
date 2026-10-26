import { keyedHash } from '../../../src/lib/comments/environment';
import type { VisitorDto } from '../../../src/lib/comments/dto';
import { commentsApiHandler } from '../../../src/lib/comments/http';
import { displayName, expiredVisitorCookie } from '../../../src/lib/comments/visitor';

// GET /api/visitor - who the toolbar's profile shows
export const GET = commentsApiHandler(async ({ visitor }) => Response.json({
    name: visitor.name ?? (visitor.hasCookie ? displayName(visitor.authorId) : null),
    ...(visitor.member ? { member: true } : {}),
    draftScope: visitor.authorId ? keyedHash('draft-scope', visitor.authorId) : undefined
} satisfies VisitorDto));

// DELETE /api/visitor - signs out: removes the visitor cookie from this browser. The comments
// stay; this browser can no longer resolve or delete them. Never creates an identity.
export const DELETE = commentsApiHandler(async ({ request }) => new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': expiredVisitorCookie(request) }
}), { createVisitor: false });
