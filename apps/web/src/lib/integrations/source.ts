import type { DbProject } from '../app/model';
import type { AppStore } from '../app/store';
import { isPrivateAppFeedback } from '../comments/publicProject';
import type { DbComment } from '../db/schema';
import { proofStore } from '../proofs/store';

/** The same source gate applies to backfill, provider calls, inbound updates and member links. */
export async function canSyncThread(project: DbProject, source: DbComment, store: AppStore) {
    if (source.private || isPrivateAppFeedback(source)) return false;
    const target = source.assetTarget;
    if (!target) return true;
    if (project.transfer || source.projectId !== project.id || source.domain !== `project:${project.id}`) return false;
    const proofs = proofStore(project.id, store);
    const [guard, asset, version] = await Promise.all([
        proofs.guard(), proofs.asset(target.assetId), proofs.version(target.source.versionId)
    ]);
    return !guard?.doc.deleted && Boolean(asset?.doc.currentVersionId && !asset.doc.deleted
        && version?.doc.assetId === target.assetId && version.doc.status === 'published');
}
