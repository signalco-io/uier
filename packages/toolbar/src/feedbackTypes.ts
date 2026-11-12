/** Browser-safe feedback vocabulary. IDs survive renames, disabled types and inheritance changes. */
export const feedbackTypeIcons = ['heart', 'bug', 'message', 'sparkles', 'rocket', 'bookmark', 'info', 'lightning'] as const;
export type FeedbackTypeIcon = typeof feedbackTypeIcons[number];
export type FeedbackTypeId = 'feedback' | 'bug' | `custom_${string}`;
export type CommentKind = 'comment' | 'rewrite' | FeedbackTypeId;
export type FeedbackTypeSnapshot = { id: FeedbackTypeId; label: string; icon: FeedbackTypeIcon };
export type FeedbackType = FeedbackTypeSnapshot & { enabled: boolean; placeholder: string };
export const MAX_FEEDBACK_TYPES = 12;
export const MAX_FEEDBACK_TYPE_LABEL = 40;
export const MAX_FEEDBACK_TYPE_PLACEHOLDER = 300;
export const customFeedbackTypePattern = /^custom_[A-Za-z0-9_-]{12,64}$/;

export const defaultFeedbackTypes: readonly FeedbackType[] = [
    { id: 'feedback', label: 'Feedback', icon: 'heart', enabled: true, placeholder: 'What works well, what could be better?' },
    { id: 'bug', label: 'Bug report', icon: 'bug', enabled: true, placeholder: 'What went wrong, and what did you expect?' }
];

export function isFeedbackTypeId(value: unknown): value is FeedbackTypeId {
    return typeof value === 'string' && (value === 'feedback' || value === 'bug' || customFeedbackTypePattern.test(value));
}
export function isCommentKind(value: unknown): value is CommentKind {
    return value === 'comment' || value === 'rewrite' || isFeedbackTypeId(value);
}

/** Only display fields, never placeholder/configuration or arbitrary stored properties. */
export function feedbackTypeSnapshot(value: unknown, kind: unknown): FeedbackTypeSnapshot | undefined {
    if (!value || typeof value !== 'object' || !isFeedbackTypeId(kind)) return undefined;
    const type = value as Partial<FeedbackTypeSnapshot>;
    if (type.id !== kind || typeof type.label !== 'string' || !type.label.trim() || type.label.length > MAX_FEEDBACK_TYPE_LABEL
        || /[\p{Cc}\p{Cf}]/u.test(type.label) || !feedbackTypeIcons.includes(type.icon!)) return undefined;
    return { id: kind, label: type.label, icon: type.icon! };
}

export function commentKindLabel(kind: CommentKind, snapshot?: FeedbackTypeSnapshot): string {
    return feedbackTypeSnapshot(snapshot, kind)?.label
        ?? (kind === 'comment' ? 'Comment' : kind === 'rewrite' ? 'Suggested rewrite' : defaultFeedbackTypes.find(type => type.id === kind)?.label ?? 'Feedback');
}
export function commentKindIcon(kind: CommentKind, snapshot?: FeedbackTypeSnapshot): FeedbackTypeIcon {
    return feedbackTypeSnapshot(snapshot, kind)?.icon ?? defaultFeedbackTypes.find(type => type.id === kind)?.icon ?? 'message';
}

/**
 * The page check a comment was posted from (the toolbar's Accessibility and SEO panels): which
 * kind of check, and the id of its rule or check (`image-alt`, `canonical`, `lcp`). Sent by the
 * browser, so only this closed vocabulary and a short id are ever kept.
 */
export const commentCheckTypes = ['accessibility', 'seo', 'consent', 'web-vitals'] as const;
export type CommentCheckType = typeof commentCheckTypes[number];
/**
 * `count`: one comment for several elements of the check on its page (the panels' "Comment on all"),
 * how many; missing on a comment about one element or the page (and on every older comment)
 */
export type CommentCheck = { type: CommentCheckType; id: string; count?: number };
export const commentCheckIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The most elements one comment says it covers; a larger group is sent as this many */
export const commentCheckCountMax = 10_000;
export const commentCheckLabels: Record<CommentCheckType, string> = { accessibility: 'Accessibility', seo: 'SEO', consent: 'Security and compliance', 'web-vitals': 'Core Web Vitals' };

/** Whether a check's `count` is one this version keeps: a whole number of elements from 2 */
export function isCommentCheckCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= commentCheckCountMax;
}

/** Only the known fields of a stored or received check, or nothing; a `count` that is not one is left out */
export function commentCheck(value: unknown): CommentCheck | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const { type, id, count } = value as Partial<CommentCheck>;
    return commentCheckTypes.includes(type!) && typeof id === 'string' && commentCheckIdPattern.test(id)
        ? { type: type!, id, ...isCommentCheckCount(count) ? { count } : {} } : undefined;
}
