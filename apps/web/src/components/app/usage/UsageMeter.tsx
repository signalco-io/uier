'use client';

import { useId } from 'react';
import { cn } from 'cn';
import { Progress, ProgressLabel } from '@/src/components/ui/progress';

/**
 * How much of a limit its current window used ("3 of 100") over a bar: amber from 80 %, red with
 * "Limit reached" once it is used up (in words too, not only in colour). The description goes under the
 * bar, so the bars of a row line up.
 */
export function UsageMeter({ label, description, used, limit }: { label: string; description?: string; used: number; limit: number }) {
    const descriptionId = useId();
    const reached = used >= limit;
    const near = !reached && used >= limit * 0.8;
    const value = `${used} of ${limit}`;
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <Progress
                value={Math.min(used, limit)}
                max={limit}
                getAriaValueText={() => reached ? `${value}, limit reached` : value}
                aria-describedby={description ? descriptionId : undefined}
                className={cn('gap-x-3 gap-y-2',
                    reached && '[&_[data-slot=progress-indicator]]:bg-destructive',
                    near && '[&_[data-slot=progress-indicator]]:bg-[hsl(var(--brand-warning))]')}>
                <ProgressLabel className="min-w-0 flex-1 font-normal">{label}</ProgressLabel>
                <span className={cn('shrink-0 text-sm tabular-nums', reached ? 'text-destructive' : 'text-muted-foreground')}>
                    {reached ? `Limit reached · ${value}` : value}
                </span>
            </Progress>
            {description && <p id={descriptionId} className="m-0 text-xs text-muted-foreground">{description}</p>}
        </div>
    );
}
