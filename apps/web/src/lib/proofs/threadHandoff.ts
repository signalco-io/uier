import { feedbackMarkdown, type FeedbackContext, type FeedbackExport, type FeedbackMessage } from '@uier/toolbar/feedback-context';
import { feedbackStage } from '@uier/toolbar/verification';
import type { DbProject } from '../app/model';
import { statusForComment, type StatusWorkflow } from '../app/statusWorkflow';
import type { DbComment } from '../db/schema';
import { assignedUserIds } from '../review/assignments';
import { proofNotFound, proofStore, type DbProofAsset } from './store';
import { proofThreadLocation, proofThreadPath } from './threadModel';

export async function requirePublishedProofVersion(projectId: string, assetId: string, versionId: string, proofs = proofStore(projectId)) {
    const saved = await proofs.version(versionId);
    if (!saved || saved.doc.assetId !== assetId || saved.doc.status !== 'published') throw proofNotFound();
    return saved.doc;
}

export function proofThreadUrl(project: DbProject, comment: DbComment, baseUrl: string, versionId?: string) {
    const target = comment.assetTarget;
    if (!target) throw proofNotFound();
    return new URL(proofThreadPath(project.publicId ?? project.id, target.assetId, versionId ?? target.source.versionId, comment.id), baseUrl).href;
}

/** The caller has checked actor visibility and the published asset. Project only saved discussion and safe links. */
export function proofThreadHandoff(project: DbProject, comment: DbComment, baseUrl: string, options?: {
    asset: DbProofAsset; workflow: StatusWorkflow; participants: ReadonlyMap<string, string>; versionId?: string;
}): FeedbackExport {
    const target = comment.assetTarget;
    if (!target) throw proofNotFound();
    const original = proofThreadUrl(project, comment, baseUrl);
    const location = proofThreadLocation(target, comment.verification?.evidence, options?.versionId);
    const proof = { assetId: target.assetId, sourceVersionId: target.source.versionId };
    const assignees = options && assignedUserIds(comment).map(id => ({ name: options.participants.get(id) ?? 'Former member' }));
    const messages = comment.thread.items.map((item): FeedbackMessage => ({
        id: item.id,
        createdAt: item.createdAt,
        deleted: Boolean(item.deletedAt),
        ...(!item.deletedAt ? { text: item.text, editedAt: item.editedAt } : {})
    }));
    const first = messages[0] ?? null;
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted',
        identity: { projectId: project.id, assetId: target.assetId, commentId: comment.id, number: comment.number, itemId: first?.id },
        title: first?.text?.replace(/\s+/g, ' ').trim().slice(0, 100) || 'File feedback',
        kind: 'comment',
        archivedAt: comment.archivedAt,
        status: comment.resolved ? 'done' : 'open',
        stage: feedbackStage({ ...comment, verificationEnabled: project.verificationEnabled === true }),
        proof: options ? { ...proof, currentVersionId: options.asset.currentVersionId, versionId: location.versionId,
            anchorKind: location.anchor.kind } : proof,
        ...(options ? { workflowStatus: statusForComment(options.workflow, comment) } : {}),
        ...(assignees?.length ? { assignees, assignee: assignees[0] } : {}),
        feedback: first,
        discussion: messages.slice(1),
        anchor: { type: 'page' },
        source: { path: new URL(original).pathname },
        links: { comment: original,
            ...(options?.versionId && options.versionId !== target.source.versionId
                ? { revision: proofThreadUrl(project, comment, baseUrl, options.versionId) } : {}) },
        reproduction: {},
        screenshot: { state: 'unavailable' },
        notes: ['Open the file review in uier to see the location and revision evidence.']
    };
    return { context, markdown: feedbackMarkdown(context) };
}
