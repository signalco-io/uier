/** Browser-safe names and parser: this cookie holds only a presentation preference, never access. */
export const commentsViewCookieNames = { secure: '__Host-uier_comments_view', local: 'uier_comments_view' } as const;

export function parseCommentsView(value: string | undefined | null): 'list' | 'board' | undefined {
    return value === 'list' || value === 'board' ? value : undefined;
}
