import { pageQueryKeys, pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';
import type { DbComment } from '../db/schema';
import { getCommentsStore } from '../repo/commentsStore';
import { projectPartition } from '../review/comments';
import type { DbProject } from './model';

/** How many of the newest comments settings looks at */
const RECENT_COMMENTS = 200;
const MAX_SUGGESTIONS = 8;

export type QueryFieldSuggestion = { key: string; comments: number };

/**
 * Query fields the project does not use yet, most common first: names the toolbar saw on the page
 * when a comment was posted, and names in the stored path (old comments, fields since removed).
 */
export function queryFieldSuggestions(comments: Pick<DbComment, 'path' | 'queryKeys'>[], policy?: Partial<PageStatePolicy>): QueryFieldSuggestion[] {
    const approved = new Set(pageStatePolicy(policy).queryParameters);
    const counts = new Map<string, number>();
    for (const comment of comments) {
        const keys = new Set([...pageStatePolicy({ queryParameters: comment.queryKeys }).queryParameters, ...pageQueryKeys(comment.path)]);
        for (const key of keys)
            if (!approved.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => ({ key, comments: count }))
        .sort((a, b) => b.comments - a.comments || a.key.localeCompare(b.key))
        .slice(0, MAX_SUGGESTIONS);
}

export async function loadQueryFieldSuggestions(project: DbProject) {
    const comments = await getCommentsStore().listAll(projectPartition(project.id), RECENT_COMMENTS);
    return queryFieldSuggestions(comments, project.pageState);
}
