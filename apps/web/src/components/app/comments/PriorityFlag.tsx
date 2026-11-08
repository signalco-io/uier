import { FlagIcon, type LucideProps } from 'lucide-react';
import { priorityLabels, type CommentPriority } from '@uier/toolbar/triage';
import { cn } from '@/src/lib/utils';

/**
 * Each priority's flag colour from the brand tokens (BRAND.md, "Colour"): Low muted, Normal ink,
 * High amber, Urgent red. Set as the stroke, not the text colour, so a highlighted menu or select
 * item (which sets the text colour of everything inside it) keeps the colour.
 */
const flagColors: Record<CommentPriority, string> = {
    low: 'stroke-[hsl(var(--muted-foreground))]',
    normal: 'stroke-[hsl(var(--foreground))]',
    high: 'stroke-[hsl(var(--brand-warning))]',
    urgent: 'stroke-[hsl(var(--destructive))]'
};

/** The priority's flag. Decorative: the priority's name always stands next to it, so colour is never the only signal. */
export function PriorityFlag({ priority, className, ...props }: { priority: CommentPriority } & Omit<LucideProps, 'ref'>) {
    return <FlagIcon aria-hidden="true" data-priority={priority} {...props} className={cn('shrink-0', flagColors[priority], className)} />;
}

/** The flag and the name, on list rows and board cards; assistive tech reads "Priority: High" */
export function PriorityLabel({ priority }: { priority: CommentPriority }) {
    return (
        <span className="inline-flex items-center gap-1 text-foreground">
            <PriorityFlag priority={priority} className="size-3.5" />
            <span className="sr-only">Priority: </span>
            {priorityLabels[priority]}
        </span>
    );
}
