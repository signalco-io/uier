/** Browser-safe label vocabulary. Colours reference the existing brand palette only. */
export const labelColors = ['ink', 'blue', 'sky', 'violet', 'green', 'amber', 'red'] as const;
export const labelIcons = ['tag', 'bug', 'sparkles', 'accessibility', 'paintbrush', 'code', 'file-text', 'flag'] as const;
export type ThreadLabel = { id: string; name: string; color: typeof labelColors[number]; icon?: typeof labelIcons[number]; description: string };
export const MAX_THREAD_LABELS = 20;
export const labelColorTokens: Record<ThreadLabel['color'], string> = {
    ink: '--foreground', blue: '--brand-accent-text', sky: '--brand-in-progress', violet: '--brand-ready',
    green: '--brand-success', amber: '--brand-warning', red: '--destructive'
};
export function assignedLabelIds(comment: { labelIds?: string[] }): string[] {
    return Array.isArray(comment.labelIds) ? [...new Set(comment.labelIds.filter(id => typeof id === 'string' && /^label_[a-zA-Z0-9_-]{1,64}$/.test(id)))].slice(0, MAX_THREAD_LABELS) : [];
}
/** Definitions removed from the effective catalog disappear without rewriting historical threads. */
export function labelsForComment(labels: ThreadLabel[], comment: { labelIds?: string[] }) {
    const ids = assignedLabelIds(comment);
    return labels.filter(label => ids.includes(label.id));
}
