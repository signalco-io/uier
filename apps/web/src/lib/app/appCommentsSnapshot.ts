import { effectiveThreadLabels } from './threadLabels';
import { effectiveStatusWorkflow } from './statusWorkflows';
import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import { appActor } from './projectComments';
import { loadProjectCommentPages, type ProjectCommentPageInput } from './projectCommentPages';
import { environmentOptions, isEnvironmentSelection } from './environments';
import { resolveCommentAuthorFilter } from './commentAuthors';
import { boardSortsOf } from './boardSort';
import { canSortProjectBoard } from './projectBoard';
import { CommentQueryBudgetError } from '../repo/commentQuerySource';
import { projectCommentPageKey, type ProjectCommentPaging } from './projectCommentPaging';
import { listProjectMembers } from './members';
import type { AppContext } from './context';
import type { DbProject } from './model';
import type { CommentsQuery } from '../../components/app/comments/commentsQuery';

/** Use the same authorized view for a page render and its cheap-to-transfer idle check. */
export async function loadAppCommentsSnapshot(context: AppContext, project: DbProject, input: CommentsQuery, loadRequestMembers?: () => ReturnType<typeof listProjectMembers>, t: AppTranslator = englishAppTranslator, page: ProjectCommentPageInput = {}) {
    const author = input.author ? await resolveCommentAuthorFilter(context, project, input.author) : undefined;
    if (input.author && !author) return null;
    const workflow = effectiveStatusWorkflow(context.workspace, project);
    const query = { ...input, ...(workflow.verificationEnabled !== true && input.status === 'ready' ? { status: 'active' as const } : {}), environment: isEnvironmentSelection(project, input.environment) ? input.environment : 'all' };
    const membersForRequest = loadRequestMembers?.() ?? listProjectMembers(context.workspace.id, project.id);
    const [data, members] = await Promise.all([
        loadProjectCommentPages(context, project, query, membersForRequest, author?.authorId, page, t).catch(error => {
            if (!(error instanceof CommentQueryBudgetError) || !page.budgetFallback) throw error;
            // The page retains its scope controls without pretending that partial counts are complete.
            // HTTP page requests still report 422, so existing rows survive a failed refresh.
            const paging: ProjectCommentPaging = {
                key: projectCommentPageKey(query, boardSortsOf(project.boardSorts), page.archiveExpanded ?? Boolean(project.boardArchiveExpanded), workflow, `${project.id}:${context.user.id}`, project.boardGroupByLabel ? effectiveThreadLabels(context.workspace, project).map(label => label.id) : false),
                lanes: {}, statusCounts: { active: 0, open: 0, 'in-progress': 0, ready: 0, done: 0, all: 0, archived: 0 },
                statusUnread: { active: 0, open: 0, 'in-progress': 0, ready: 0, done: 0, all: 0, archived: 0 },
                scopeTotal: 0, matchedTotal: 0, unreadCount: 0, pages: [], historySources: [], queryTooExpensive: true
            };
            return { comments: [], openedComment: undefined, paging, revision: 'query-too-expensive' };
        }),
        membersForRequest
    ]);
    const snapshot = {
        boardGroupByLabel: Boolean(project.boardGroupByLabel),
        labels: effectiveThreadLabels(context.workspace, project),
        workflow,
        environments: environmentOptions(project), projectId: project.id, access: project.access, isAdmin: context.isAdmin,
        ...data, query, authorFilter: author?.filter, userId: context.user.id,
        boardSorts: boardSortsOf(project.boardSorts), boardArchiveExpanded: Boolean(project.boardArchiveExpanded), canSortBoard: canSortProjectBoard(project, appActor(context)),
        assignees: members.map(({ member, name, avatarUrl }) => ({ userId: member.userId, name, avatarUrl }))
    };
    return snapshot;
}
