import { CheckIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';

const steps = ['Your site', 'Add the script', 'Invite a reviewer'] as const;

/** Where a new project is in onboarding: the site, the script, then the first reviewer */
export function OnboardingSteps({ current, className }: { current: 1 | 2 | 3; className?: string }) {
    return (
        <ol aria-label="Onboarding progress" className={cn('m-0 flex list-none flex-col gap-3 p-0 sm:flex-row sm:items-center', className)}>
            {steps.map((label, index) => {
                const number = index + 1;
                const done = number < current;
                const active = number === current;
                return (
                    <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-3 sm:not-last:flex-1">
                        <span
                            aria-hidden="true"
                            className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
                                done || active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'
                            )}>
                            {done ? <CheckIcon className="size-3.5" /> : number}
                        </span>
                        <span className={cn('min-w-0 truncate text-sm font-medium', !done && !active && 'text-muted-foreground')}>
                            <span className="sr-only">Step {number} of {steps.length}: </span>
                            {label}
                            {done && <span className="sr-only"> (done)</span>}
                        </span>
                        {number < steps.length && (
                            <span aria-hidden="true" className={cn('hidden h-px min-w-3 flex-1 sm:block', done ? 'bg-primary' : 'bg-border')} />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
