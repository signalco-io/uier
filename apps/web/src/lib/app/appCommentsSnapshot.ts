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
import { listProjectMembers } from './members';
import type { AppContext } from './context';
import type { DbProject } from './model';
import type { CommentsQuery } from '../../components/app/comments/commentsQuery';

/** Use the same authorized view for a page render and its cheap-to-transfer idle check. */
export async function loadAppCommentsSnapshot(context: AppContext, project: DbProject, input: CommentsQuery, loadRequestMembers?: () => ReturnType<typeof listProjectMembers>, t: AppTranslator = englishAppTranslator, page: ProjectCommentPageInput = {}) {
    const author = input.author ? await resolveCommentAuthorFilter(context, project, input.author) : undefined;
    if (input.author && !author) return null;
    const query = { ...input, environment: isEnvironmentSelection(project, input.environment) ? input.environment : 'all' };
    const membersForRequest = loadRequestMembers?.() ?? listProjectMembers(context.workspace.id, project.id);
    const [data, members] = await Promise.all([
        loadProjectCommentPages(context, project, query, membersForRequest, author?.authorId, page, t),
        membersForRequest
    ]);
    const snapshot = {
        labels: effectiveThreadLabels(context.workspace, project),
        workflow: effectiveStatusWorkflow(context.workspace, project),
        environments: environmentOptions(project), projectId: project.id, access: project.access, isAdmin: context.isAdmin,
        ...data, query, authorFilter: author?.filter, userId: context.user.id,
        boardSorts: boardSortsOf(project.boardSorts), boardArchiveExpanded: Boolean(project.boardArchiveExpanded), canSortBoard: canSortProjectBoard(project, appActor(context)),
        assignees: members.map(({ member, name, avatarUrl }) => ({ userId: member.userId, name, avatarUrl }))
    };
    return snapshot;
}
