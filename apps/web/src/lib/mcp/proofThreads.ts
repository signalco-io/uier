import { z } from 'zod';
import { feedbackStage } from '@uier/toolbar/verification';
import { orderedStatuses, statusForComment } from '../app/statusWorkflow';
import { loadStatusWorkflow } from '../app/statusWorkflows';
import { apiErrors } from '../comments/http';
import { listPage } from '../comments/listPage';
import type { DbProject } from '../app/model';
import { proofProject } from '../proofs/access';
import { proofNotFound } from '../proofs/store';
import { liveProofThreadAsset } from '../proofs/threadAccess';
import { proofThreadHandoff, proofThreadUrl, requirePublishedProofVersion } from '../proofs/threadHandoff';
import { proofThreadLocation } from '../proofs/threadModel';
import { assertCanUseComments } from '../review/actor';
import { canSeeComment, commentVisibilityFilter, getProjectComment, projectPartition } from '../review/comments';
import { assignedUserIds } from '../review/assignments';
import { participantNames } from '../review/dto';
import { commentPageCursor, formatCommentPageCursor } from '../repo/commentPage';
import { getCommentsStore } from '../repo/commentsStore';
import { mcpProject, requireMcpScope, type McpIdentity } from './credentials';

export const proofAssetId = z.string().uuid();
export const proofVersionId = z.string().regex(/^[a-f0-9]{32}$/);
export const proofThreadSelector = {
    assetId: proofAssetId.optional().describe('For file feedback, the owning asset ID from list_proof_files. Omit for website feedback.')
};
export const proofReadSelector = {
    ...proofThreadSelector,
    versionId: proofVersionId.optional().describe('Optional published revision with a saved thread location. Requires assetId.')
};

type Target = { projectId: string; assetId?: string; versionId?: string };

export async function agentThreadProject(identity: McpIdentity, target: Target, reauthenticate: () => Promise<McpIdentity>,
    operation: 'feedback:read' | 'feedback:reply' | 'feedback:status' | 'feedback:assign' = 'feedback:read') {
    const { projectId, assetId, versionId } = target;
    if (!assetId) {
        if (versionId) throw apiErrors.invalidRequest('Send assetId with versionId.');
        return { ...await mcpProject(identity, projectId, operation), asset: null };
    }
    return resolve(identity, assetId);

    async function resolve(current: McpIdentity, selectedAsset: string): Promise<Omit<Awaited<ReturnType<typeof mcpProject>>, 'project'> & {
        project: DbProject;
        asset: NonNullable<Awaited<ReturnType<typeof liveProofThreadAsset>>>;
    }> {
        const { project, actor, user } = await mcpProject(current, projectId, 'proofs:read');
        if (operation !== 'feedback:read') requireMcpScope(current, operation);
        const live = await proofProject(projectId);
        if (live.workspaceId !== project.workspaceId) throw proofNotFound();
        if (current.proofAssetIds && !current.proofAssetIds.includes(selectedAsset)) throw proofNotFound();
        const asset = await liveProofThreadAsset(live, selectedAsset);
        if (!asset) throw proofNotFound();
        if (versionId) await requirePublishedProofVersion(projectId, asset.id, versionId);
        return { project: live, user, asset, actor: { ...actor, proofThread: { assetId: asset.id, async refresh(write) {
            const fresh = await resolve(await reauthenticate(), selectedAsset);
            if (fresh.user.id !== user.id || fresh.project.workspaceId !== live.workspaceId) throw proofNotFound();
            if (write) assertCanUseComments(fresh.project, fresh.actor);
            return fresh;
        } } } };
    }
}

export function agentProofThreadReader(auth: Awaited<ReturnType<typeof agentThreadProject>>, baseUrl: string, versionId?: string) {
    const { project, actor, asset } = auth;
    if (!asset) throw proofNotFound();
    let display: Promise<[Awaited<ReturnType<typeof loadStatusWorkflow>>, Awaited<ReturnType<typeof participantNames>>]> | undefined;
    return async (id: string) => {
        const comment = await getProjectComment(project, actor, id);
        const target = comment?.assetTarget;
        if (!comment || !target) throw proofNotFound();
        const location = proofThreadLocation(target, comment.verification?.evidence, versionId);
        if (versionId && location.versionId !== versionId) throw proofNotFound();
        await requirePublishedProofVersion(project.id, asset.id, target.source.versionId);
        const [workflow, participants] = await (display ??= Promise.all([loadStatusWorkflow(project), participantNames(project)]));
        return proofThreadHandoff(project, comment, baseUrl, { asset, workflow, participants, versionId });
    };
}

export async function agentProofThreadPage(auth: Awaited<ReturnType<typeof agentThreadProject>>, baseUrl: string, input: {
    versionId?: string; limit: number; cursor?: string; archive: 'exclude' | 'only' | 'all';
}) {
    const { project, actor, asset } = auth;
    if (!asset) throw proofNotFound();
    const domain = projectPartition(project.id);
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor !== undefined) query.set('before', input.cursor);
    const page = listPage(query)!;
    const [stored, workflow] = await Promise.all([
        getCommentsStore().listPage(domain, { ...page, limit: input.limit + 1, archive: input.archive,
            proof: { asset: asset.id, versionId: input.versionId, visibility: commentVisibilityFilter(domain, actor) } }),
        loadStatusWorkflow(project)
    ]);
    const current = (await actor.proofThread!.refresh(false)).actor;
    const items = stored.slice(0, input.limit).filter(comment => canSeeComment(comment, current)).map(comment => {
        const sourceVersionId = comment.assetTarget!.source.versionId;
        const first = comment.thread.items[0];
        return {
            id: comment.id, number: comment.number, assetId: asset.id, sourceVersionId, currentVersionId: asset.currentVersionId,
            summary: first?.deletedAt ? 'Comment deleted' : first?.text.slice(0, 240),
            assigneeIds: assignedUserIds(comment),
            stage: feedbackStage({ ...comment, verificationEnabled: project.verificationEnabled === true }),
            workflowStatus: statusForComment(workflow, comment), private: Boolean(comment.private), archivedAt: comment.archivedAt,
            links: { comment: proofThreadUrl(project, comment, baseUrl),
                ...(input.versionId && input.versionId !== sourceVersionId
                    ? { revision: proofThreadUrl(project, comment, baseUrl, input.versionId) } : {}) }
        };
    });
    return { items, statuses: orderedStatuses(workflow),
        nextCursor: stored.length > input.limit ? formatCommentPageCursor(commentPageCursor(stored[input.limit - 1]!)) : null };
}
