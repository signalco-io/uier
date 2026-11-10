import { SVGProps } from 'react';
import { AI, Bookmark, Bug, Comment, Info, Lightning, Replace, Rocket } from '@signalco/ui-icons';
import { commentKindIcon, type FeedbackTypeSnapshot } from '../feedbackTypes';
import { useMessages } from '../i18n';
import { commentKindText } from '../i18n/format';
import type { CommentKind } from './@types/Comments';

/** Lucide's heart (the UI kit has no heart icon), drawn like the kit's icons next to it */
export function HeartIcon({ size = 24, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}>
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
    );
}

export function CommentKindIcon({ kind, feedbackType, size = 16 }: { kind: Exclude<CommentKind, 'comment'>; feedbackType?: FeedbackTypeSnapshot; size?: number }) {
    if (kind === 'rewrite') return <Replace size={size} aria-hidden="true" />;
    const icon = commentKindIcon(kind, feedbackType);
    if (icon === 'heart') return <HeartIcon size={size} />;
    const Icon = { bug: Bug, message: Comment, sparkles: AI, rocket: Rocket, bookmark: Bookmark, info: Info, lightning: Lightning }[icon];
    return <Icon size={size} aria-hidden="true" />;
}

/** The saved type above a thread's first message. Plain comments have no chip. */
export function CommentKindLabel({ kind, feedbackType }: { kind: CommentKind; feedbackType?: FeedbackTypeSnapshot }) {
    const t = useMessages();
    if (kind === 'comment') return null;
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary-foreground">
        <CommentKindIcon kind={kind} feedbackType={feedbackType} size={14} />
        {commentKindText(kind, feedbackType, t)}
    </span>;
}
