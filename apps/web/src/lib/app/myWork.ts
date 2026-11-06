import type { AppContext } from './context';
import { loadProjectComments, type ProjectCommentView } from './projectComments';
import { listVisibleProjects } from './projects';

export type MyWorkItem = { projectId: string; projectName: string; comment: ProjectCommentView };

export type MyWork = {
    /** Open threads assigned to the signed-in member */
    assigned: MyWorkItem[];
    /** Open threads whose messages mention them, not assigned to them */
    mentions: MyWorkItem[];
    /** Other threads with activity they have not read */
    unread: MyWorkItem[];
    /** A project's comments were capped at its 1,000 most recent threads */
    capped: boolean;
};

/**
 * Across every project of the current workspace the member can see, the threads that need them: each
 * thread once, in the first group it belongs to (assigned, then mentions, then unread), newest first.
 * The same authorized snapshot as each project's comments page; nothing new is stored.
 */
export async function loadMyWork(context: AppContext): Promise<MyWork> {
    const projects = await listVisibleProjects(context);
    let capped = false;
    const perProject = await Promise.all(projects.map(async project => {
        const comments = await loadProjectComments(context, project, 'all', undefined, windowCapped => { capped ||= windowCapped; });
        return comments.map(comment => ({ projectId: project.id, projectName: project.name, comment }));
    }));
    const items = perProject.flat().sort((a, b) => (b.comment.createdAt ?? '').localeCompare(a.comment.createdAt ?? ''));
    const assigned = items.filter(({ comment }) => !comment.resolved && comment.assignee?.id === context.user.id);
    const listed = new Set(assigned.map(item => item.comment.id));
    const mentions = items.filter(({ comment }) => !comment.resolved && comment.mentionsMe && !listed.has(comment.id));
    for (const item of mentions) listed.add(item.comment.id);
    const unread = items.filter(({ comment }) => comment.activity?.unread && !listed.has(comment.id));
    return { assigned, mentions, unread, capped };
}
