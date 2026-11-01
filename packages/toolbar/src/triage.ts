/** Shared, browser-safe triage vocabulary. Old records and pinned clients default to Normal. */
export const priorities = ['low', 'normal', 'high', 'urgent'] as const;
export type CommentPriority = typeof priorities[number];
export const priorityLabels: Record<CommentPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export function commentPriority(value: unknown): CommentPriority {
    return priorities.includes(value as CommentPriority) ? value as CommentPriority : 'normal';
}
export const MAX_FEEDBACK_SEARCH = 200;
export type SearchableFeedback = {
    context?: readonly string[];
    number?: number;
    path: string;
    messages: readonly { text?: string; quotedText?: string; deleted?: boolean }[];
};
/** Every whitespace-separated word must occur literally, case-insensitively, in visible text. */
export function matchesFeedbackSearch(feedback: SearchableFeedback, query: string) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = [...(feedback.context ?? []), feedback.number === undefined ? '' : `#${feedback.number}`, feedback.path,
        ...feedback.messages.flatMap(message => message.deleted ? [] : [message.text ?? '', message.quotedText ?? ''])].join('\n').toLowerCase();
    return words.every(word => text.includes(word));
}
