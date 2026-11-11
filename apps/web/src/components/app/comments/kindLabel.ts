import { commentKindLabel, defaultFeedbackTypes, type CommentKind, type FeedbackTypeSnapshot } from '@uier/toolbar/feedback-types';
import type { AppTranslator } from '@/src/lib/i18n/types';

/** Built-in vocabulary follows the app language; names a workspace chose stay exactly as written. */
export function localizedKindLabel(kind: CommentKind, snapshot: FeedbackTypeSnapshot | undefined, t: AppTranslator) {
    const label = commentKindLabel(kind, snapshot);
    const builtin = kind === 'comment' || kind === 'rewrite' || defaultFeedbackTypes.some(type => type.id === kind && type.label === label);
    return builtin ? t(label) : label;
}
