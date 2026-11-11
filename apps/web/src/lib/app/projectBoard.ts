import { z } from 'zod';
import { canTriageProject } from '../review/comments';
import type { ProjectActor } from '../review/actor';
import { UserFacingError } from './actionErrors';
import { withBoardSort, type BoardColumn, type BoardSort } from './boardSort';
import { boardSortInputSchema } from './boardSortSchema';
import type { DbProject } from './model';
import { updateDoc, getAppStore, type AppStore } from './store';

/**
 * Whether the person may change how the project's board columns sort: the people who triage it, who move its
 * cards too (every member; on uier's own feedback projects, where accounts see only their own threads, its staff).
 */
export function canSortProjectBoard(project: Pick<DbProject, 'id'>, actor: ProjectActor) {
    return canTriageProject(project, actor);
}

/**
 * Saves one board column's sort (Archive's too) on the project, for everyone who opens its board. The column and the choice
 * are validated again here, and so is the person (`canSortProjectBoard`). Unlike `updateProject`, uier's
 * feedback projects take it too: it is how their staff's board reads, not a setting uier manages.
 */
export async function saveProjectBoardSort(project: DbProject, actor: ProjectActor, status: BoardColumn, sort: BoardSort, store: AppStore = getAppStore()) {
    const input = boardSortInputSchema.safeParse({ status, sort });
    if (!input.success)
        throw new UserFacingError('Choose a sort this column offers.');
    if (!canSortProjectBoard(project, actor))
        throw new UserFacingError('You can’t change how this board is sorted.');
    const { status: column, sort: choice } = input.data;
    // The current choice again: nothing to write
    if (JSON.stringify(withBoardSort(project, column, choice).boardSorts) === JSON.stringify(project.boardSorts))
        return project;
    const saved = await updateDoc<DbProject>(project.pk, project.id, current => withBoardSort(current, column, choice), store);
    if (!saved)
        throw new UserFacingError('This project no longer exists.');
    return saved;
}

/**
 * Expands or collapses the board's Archive column on the project, for everyone who opens its board, like a
 * column's sort (the same people, `canSortProjectBoard`). The choice is validated again here: anything but a
 * boolean is refused before a write. Collapsed is the default and leaves no field.
 */
export async function saveProjectBoardArchive(project: DbProject, actor: ProjectActor, expanded: boolean, store: AppStore = getAppStore()) {
    const input = z.boolean().safeParse(expanded);
    if (!input.success)
        throw new UserFacingError('Choose to expand or collapse the archive.');
    if (!canSortProjectBoard(project, actor))
        throw new UserFacingError('You can’t change how this board is shown.');
    if (Boolean(project.boardArchiveExpanded) === input.data)
        return project;
    const saved = await updateDoc<DbProject>(project.pk, project.id, current => {
        const { boardArchiveExpanded: _previous, ...rest } = current;
        return input.data ? { ...rest, boardArchiveExpanded: true } : rest;
    }, store);
    if (!saved)
        throw new UserFacingError('This project no longer exists.');
    return saved;
}
