'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
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

/** The priority's flag. Decorative: its name stands next to it, or names it (`PriorityLabel`), so colour is never the only signal. */
export function PriorityFlag({ priority, className, ...props }: { priority: CommentPriority } & Omit<LucideProps, 'ref'>) {
    return <FlagIcon aria-hidden="true" data-priority={priority} {...props} className={cn('shrink-0', flagColors[priority], className)} />;
}

/**
 * The flag alone, on list rows and board cards; assistive tech reads "High priority". The row's other
 * icon-only indicators (Private, the assignee) are named the same way, without a tooltip.
 */
export function PriorityLabel({ priority }: { priority: CommentPriority }) {
    const { t } = useAppI18n();
    return (
        <span role="img" aria-label={t("{priority} priority", { priority: t(priorityLabels[priority]) })} className="inline-flex items-center">
            <PriorityFlag priority={priority} className="size-3.5" />
        </span>
    );
}
