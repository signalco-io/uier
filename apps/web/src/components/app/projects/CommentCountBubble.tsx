import { cn } from '@/src/lib/utils';

/**
 * The open comment count inside a speech bubble drawn like the `MessageSquareIcon` (1.5px stroke, the tail at the bottom
 * left). The bubble widens for two and three digits; the words are for screen readers ("11 open comments").
 */
export function CommentCountBubble({ count, className }: { count: number; className?: string }) {
    return (
        <span className={cn('relative mb-1 inline-flex h-4.5 min-w-5.5 shrink-0 items-center justify-center rounded-[5px] rounded-bl-none border-[1.5px] border-current px-1 text-xs leading-none font-medium tabular-nums', className)}>
            {count}
            <span className="sr-only">{count === 1 ? ' open comment' : ' open comments'}</span>
            {/* The tail: the left side runs on and turns back into the bottom edge, which it opens */}
            <svg viewBox="0 0 7 6" aria-hidden="true" className="absolute top-full -left-[1.5px] -mt-[1.5px] h-1.5 w-[7px] overflow-visible">
                <path d="M1.5 0H6.25L1.5 4.25Z" className="fill-card" />
                <path d="M0.75 0V5.25L6.25 0.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </span>
    );
}
