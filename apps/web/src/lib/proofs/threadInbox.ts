import type { AppContext } from '../app/context';
import { listVisibleProjects } from '../app/projects';
import { readActivity } from '../comments/activity';
import { loadReadSequences } from '../comments/readState';
import { commentVisibilityFilter, projectPartition } from '../review/comments';
import { assignedUserIds } from '../review/assignments';
import { getCommentsStore } from '../repo/commentsStore';
import { proofThreadPath } from './threadModel';
import { proofStore } from './store';

const inboxLimit = 20;
const activityWindow = 200;

export async function loadProofInbox(context: AppContext, projectsForRequest = listVisibleProjects(context)) {
    const projects = await projectsForRequest;
    const reviewerId = `user:${context.user.id}`;
    const actor = { kind: 'member', userId: context.user.id, name: context.user.name, isAdmin: context.member.role === 'admin' } as const;
    const store = getCommentsStore();
    const results = await Promise.all(projects.map(async project => {
        const proofs = proofStore(project.id);
        const [assets, guard] = await Promise.all([proofs.assets(), proofs.guard()]);
        if (guard?.doc.deleted || project.transfer) return null;
        const labels = new Map(assets.filter(asset => !asset.deleted && asset.currentVersionId).map(asset => [asset.id, asset.name]));
        if (!labels.size) return null;
        const domain = projectPartition(project.id);
        const filter = { asset: [...labels.keys()], visibility: commentVisibilityFilter(domain, actor) };
        const pendingFilter = { ...filter, reviewerId };
        const pending = project.verificationEnabled === true && project.access !== 'disabled';
        const [checks, count, recent, reads] = await Promise.all([
            pending ? store.listPage(domain, { limit: inboxLimit, proof: pendingFilter }) : [],
            pending ? store.countProofThreads(domain, pendingFilter) : 0,
            store.listPage(domain, { limit: activityWindow, proof: filter, archive: 'exclude' }),
            loadReadSequences(domain, reviewerId)
        ]);
        const item = (comment: typeof recent[number], versionId: string) => ({
            id: comment.id,
            number: comment.number,
            text: comment.thread.items[0]?.deletedAt ? undefined : comment.thread.items[0]?.text,
            updatedAt: comment.updatedAt,
            assetName: labels.get(comment.assetTarget!.assetId)!,
            projectName: project.name,
            href: proofThreadPath(project.publicId ?? project.id, comment.assetTarget!.assetId, versionId, comment.id)
        });
        const activity = recent.filter(comment => (!comment.resolved && (assignedUserIds(comment).includes(context.user.id)
            || comment.thread.items.some(message => !message.deletedAt && message.mentions?.some(mention => mention.userId === context.user.id))))
            || readActivity(comment, reviewerId, reads.get(comment.id)).unread);
        return { count, checks: checks.map(comment => item(comment, comment.verification!.evidence!.after.versionId)),
            activity: activity.map(comment => item(comment, comment.assetTarget!.source.versionId)) };
    }));
    const byRecent = (a: { updatedAt?: string }, b: { updatedAt?: string }) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    const available = results.flatMap(result => result ?? []);
    const checks = available.flatMap(result => result.checks).sort(byRecent).slice(0, inboxLimit);
    const checkedIds = new Set(checks.map(item => item.id));
    return {
        count: available.reduce((sum, result) => sum + result.count, 0),
        checks,
        activity: available.flatMap(result => result.activity).filter(item => !checkedIds.has(item.id)).sort(byRecent).slice(0, inboxLimit)
    };
}
