import { SVGProps } from 'react';
import { Bug, Replace } from '@signalco/ui-icons';
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
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}>
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
    );
}

export const commentKindLabels: Record<Exclude<CommentKind, 'comment'>, string> = {
    feedback: 'Feedback',
    bug: 'Bug report',
    rewrite: 'Suggested rewrite'
};

export function CommentKindIcon({ kind, size = 16 }: { kind: Exclude<CommentKind, 'comment'>; size?: number }) {
    switch (kind) {
        case 'bug': return <Bug size={size} aria-hidden="true" />;
        case 'rewrite': return <Replace size={size} aria-hidden="true" />;
        default: return <HeartIcon size={size} />;
    }
}

/** "Feedback", "Bug report" or "Suggested rewrite" above the first message of a thread; nothing for comments */
export function CommentKindLabel({ kind }: { kind: CommentKind }) {
    if (kind === 'comment') {
        return null;
    }

    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary-foreground">
            <CommentKindIcon kind={kind} size={14} />
            {commentKindLabels[kind]}
        </span>
    );
}
