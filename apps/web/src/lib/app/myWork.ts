import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import type { AppContext } from './context';
import { commentAssignees } from '@uier/toolbar/agents';
import { loadProjectComments, type ProjectCommentView } from './projectComments';
import { listVisibleProjects } from './projects';
import { listProjectMembers } from './members';
import { compareCommentOrder } from '../../components/app/comments/commentOrder';

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
    /** The people each listed thread's project can assign, for its thread on the board (`MyWorkBoard`), by project id */
    assignees: Record<string, { userId: string; name: string; avatarUrl?: string }[]>;
};

/**
 * Across every project of the current workspace the member can see, the threads that need them: each
 * thread once, in the first group it belongs to (assigned, then mentions, then unread). Each group is in a project
 * list's order (`compareCommentOrder`: priority, then number, highest first); threads of different projects with the
 * same priority and number keep newest first.
 * The same authorized snapshot as each project's comments page, with its people to assign (the same member list,
 * read once per project); nothing new is stored.
 */
export async function loadMyWork(context: AppContext, t: AppTranslator = englishAppTranslator): Promise<MyWork> {
    const projects = await listVisibleProjects(context);
    let capped = false;
    const options = new Map<string, MyWork['assignees'][string]>();
    const perProject = await Promise.all(projects.map(async project => {
        const members = listProjectMembers(project.workspaceId, project.id);
        const [comments, people] = await Promise.all([
            loadProjectComments(context, project, 'all', undefined, windowCapped => { capped ||= windowCapped; }, members, 'exclude', t),
            members
        ]);
        options.set(project.id, people.map(({ member, name, avatarUrl }) => ({ userId: member.userId, name, avatarUrl })));
        return comments.map(comment => ({ projectId: project.id, projectName: project.name, comment }));
    }));
    const items = perProject.flat().filter(item => !item.comment.archivedAt).sort((a, b) => (b.comment.createdAt ?? '').localeCompare(a.comment.createdAt ?? ''))
        .sort((a, b) => compareCommentOrder(a.comment, b.comment));
    const assigned = items.filter(({ comment }) => !comment.resolved && commentAssignees(comment).some(person => person.id === context.user.id));
    const listed = new Set(assigned.map(item => item.comment.id));
    const mentions = items.filter(({ comment }) => !comment.resolved && comment.mentionsMe && !listed.has(comment.id));
    for (const item of mentions) listed.add(item.comment.id);
    const unread = items.filter(({ comment }) => comment.activity?.unread && !listed.has(comment.id));
    // Only the projects with a thread here: the page sends nothing about the others
    const assignees = Object.fromEntries([...new Set([...assigned, ...mentions, ...unread].map(item => item.projectId))]
        .map(id => [id, options.get(id) ?? []]));
    return { assigned, mentions, unread, capped, assignees };
}
