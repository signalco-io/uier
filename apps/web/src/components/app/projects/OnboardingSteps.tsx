import { CheckIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';

const steps = ['Your site', 'Add the script'] as const;

/** Where a new project is in onboarding: the site (`/app/projects/new`), then the install page */
export function OnboardingSteps({ current, className }: { current: 1 | 2; className?: string }) {
    return (
        <ol aria-label="Onboarding progress" className={cn('m-0 flex list-none items-center gap-3 p-0', className)}>
            {steps.map((label, index) => {
                const number = index + 1;
                const done = number < current;
                const active = number === current;
                return (
                    <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-3 not-last:flex-1">
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
                            <span aria-hidden="true" className={cn('h-px min-w-6 flex-1', done ? 'bg-primary' : 'bg-border')} />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
