import type { SqlParameter } from '@azure/cosmos';
import type { DbComment } from '../db/schema';

/**
 * The threads a reader who is not an admin may see, for storage aggregates that must not count hidden ones:
 * threads that are neither private nor at `privatePath` (uier's own app pages on the public project), and their
 * own. `commentVisibilityFilter` builds it from `canSeeComment`'s rule. No filter: every thread (admins).
 */
export type VisibilityFilter = { authorId?: string; privatePath?: string };

const pathSeparators = ['/', '?', '#'] as const;

/** The page key is `prefix` itself or a page below it, with or without query and hash state */
function atPath(path: string | undefined, prefix: string) {
    return typeof path === 'string' && (path === prefix || pathSeparators.some(separator => path.startsWith(prefix + separator)));
}

export function matchesVisibility(comment: Pick<DbComment, 'path' | 'private' | 'authorId'>, filter?: VisibilityFilter) {
    if (!filter) return true;
    const hidden = Boolean(comment.private) || (filter.privatePath !== undefined && atPath(comment.path, filter.privatePath));
    return !hidden || (Boolean(comment.authorId) && comment.authorId === filter.authorId);
}

/** The same filter as a parameterized clause; the query must already require `IS_STRING(c.path)` */
export function visibilitySql(filter?: VisibilityFilter): { clause: string; parameters: SqlParameter[] } {
    if (!filter) return { clause: '', parameters: [] };
    const parameters: SqlParameter[] = [];
    let hidden = 'IS_BOOL(c.private) AND c.private = true';
    if (filter.privatePath !== undefined) {
        hidden += ' OR c.path = @privatePath';
        parameters.push({ name: '@privatePath', value: filter.privatePath });
        pathSeparators.forEach((separator, index) => {
            hidden += ` OR STARTSWITH(c.path, @privatePath${index})`;
            parameters.push({ name: `@privatePath${index}`, value: filter.privatePath + separator });
        });
    }
    // An undefined author compares as undefined, which never matches
    const own = filter.authorId ? ' OR c.authorId = @readerId' : '';
    if (filter.authorId) parameters.push({ name: '@readerId', value: filter.authorId });
    return { clause: ` AND (NOT (${hidden})${own})`, parameters };
}
