import { authorNames } from '../../comments/authorNames';
import { commentPageCursor, type CommentPageCursor } from '../../repo/commentPage';
import { getCommentsStore } from '../../repo/commentsStore';
import { canSeeComment, commentVisibilityFilter, projectPartition } from '../../review/comments';
import { proofApiPath, proofViewerPath } from '../model';
import { proofNotFound } from '../store';
import { authorizeProofThread, type ProofThreadRoute } from '../threadAccess';
import { proofThreadPath } from '../threadModel';
import { readApprovalReview } from './service';

/** Build the record from the same asset-scoped thread feed and its current privacy rules. */
export async function exportApprovalReview(request: Request, route: ProofThreadRoute, versionId?: string) {
    const { project, actor, version, asset, permissions } = await authorizeProofThread(request, route, versionId);
    if (!version || !asset) throw proofNotFound();
    const proofProjectId = project.publicId ?? project.id;
    const domain = projectPartition(project.id);
    const { round } = await readApprovalReview(request, route, version.id);
    const store = getCommentsStore();
    const proof = { asset: asset.id, versionId: version.id, visibility: commentVisibilityFilter(domain, actor) };
    const comments = [];
    let before: CommentPageCursor | undefined;
    const limit = 100;
    do {
        const page = await store.listPage(domain, { proof, before, limit });
        const visible = page.filter(comment => canSeeComment(comment, actor) && (actor.kind === 'member' || !comment.private));
        const names = await authorNames(visible);
        for (const comment of visible) {
            comments.push({
                number: comment.number,
                href: proofThreadPath(proofProjectId, asset.id, version.id, comment.id),
                source: comment.assetTarget!.source,
                createdAt: comment.createdAt,
                updatedAt: comment.updatedAt,
                resolved: comment.resolved === true,
                archivedAt: comment.archivedAt,
                ...(actor.kind === 'member' ? { private: comment.private === true } : {}),
                messages: comment.thread.items.filter(item => !item.deletedAt).map(item => ({
                    author: (item.authorId?.startsWith('user:') ? names.get(item.authorId.slice(5)) : item.authorName) ?? undefined,
                    text: item.text, quotedText: item.quotedText, createdAt: item.createdAt, editedAt: item.editedAt
                }))
            });
        }
        before = page.length === limit ? commentPageCursor(page[limit - 1]!) : undefined;
    } while (before);
    const after = await authorizeProofThread(request, route, version.id);
    if (after.actor.kind !== actor.kind || after.project.workspaceId !== project.workspaceId
        || (actor.kind === 'member' && (after.actor.kind !== 'member' || after.actor.isAdmin !== actor.isAdmin || after.actor.userId !== actor.userId))
        || (actor.kind === 'guest' && (after.actor.kind !== 'guest' || after.actor.proofThread?.shareId !== actor.proofThread?.shareId || after.actor.visitorId !== actor.visitorId)))
        throw proofNotFound();
    const { id, number, filename, digest, contentType, size, publishedAt } = version;
    return Response.json({
        schema: 'uier-proof-review-1',
        exportedAt: new Date().toISOString(),
        asset: { id: asset.id, name: asset.name },
        version: {
            id, number, filename, digest, contentType, size, publishedAt,
            href: proofViewerPath(proofProjectId, asset.id, id),
            ...(permissions.downloadOriginal && after.permissions.downloadOriginal
                ? { originalUrl: `${proofApiPath(proofProjectId)}/assets/${asset.id}/versions/${id}/original` } : {})
        },
        approval: round ? { state: round.state, outcome: round.outcome, startedAt: round.startedAt, deadline: round.deadline,
            reviewers: round.reviewers.map(({ name, kind, required, decision }) => ({ name, kind, required, decision })),
            history: round.history } : null,
        comments
    }, { headers: { 'Content-Disposition': `attachment; filename="review-version-${number}.json"` } });
}
