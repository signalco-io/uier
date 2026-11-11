import { Badge } from '@/src/components/ui/badge';
import { cn } from '@/src/lib/utils';
import type { PullRequestState } from '@/src/lib/comments/pullRequestLinks';

const labels: Record<PullRequestState, string> = { open: 'Open', merged: 'Merged', closed: 'Closed', draft: 'Draft' };

/** Each state's dot follows BRAND.md; its label keeps colour from being the only signal. */
const stateDotColors: Record<PullRequestState, string> = {
    open: 'bg-[hsl(var(--brand-success))]',
    merged: 'bg-[hsl(var(--brand-ready))]',
    closed: 'bg-[hsl(var(--destructive))]',
    draft: 'bg-muted-foreground'
};

/** A known state as the brand's badge: a 6 px dot in the state's colour beside its name. */
export function PullRequestStateBadge({ state }: { state: PullRequestState }) {
    return (
        <Badge variant="outline" className="gap-1.5" data-pull-request-state={state}>
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', stateDotColors[state])} />
            {labels[state]}
        </Badge>
    );
}
