import Link from 'next/link';
import { CheckIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export const onboardingStepLabels = ['Your site', 'Add the script', 'Check installation', 'Invite a reviewer'] as const;

export type OnboardingStepNumber = 1 | 2 | 3 | 4;

/**
 * Where a new project is in onboarding: the site, the script, the installation check, then the first
 * reviewer. Steps with an address in `hrefs` are links (once the project exists, every step after the
 * site). Where the names don't fit (under 40rem, a container query), only the current step shows its name.
 */
export function OnboardingSteps({ current, hrefs = {}, className }: {
    current: OnboardingStepNumber;
    hrefs?: Partial<Record<OnboardingStepNumber, string>>;
    className?: string;
}) {
    return (
        <ol aria-label="Onboarding progress" className={cn('@container m-0 flex list-none items-center gap-3 p-0', className)}>
            {onboardingStepLabels.map((label, index) => {
                const number = (index + 1) as OnboardingStepNumber;
                const done = number < current;
                const active = number === current;
                const href = active ? undefined : hrefs[number];
                const content = <>
                    <span
                        aria-hidden="true"
                        className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
                            done || active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'
                        )}>
                        {done ? <CheckIcon className="size-3.5" /> : number}
                    </span>
                    <span className={cn('min-w-0 truncate text-sm font-medium', !done && !active && 'text-muted-foreground', !active && '@max-[40rem]:sr-only')}>
                        <span className="sr-only">Step {number} of {onboardingStepLabels.length}: </span>
                        {label}
                        {done && <span className="sr-only"> (done)</span>}
                    </span>
                </>;
                return (
                    <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-3 not-last:flex-auto">
                        {href ? (
                            <Link href={href} className="-m-1 flex min-w-0 items-center gap-3 rounded-md p-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&:hover>span:last-child]:text-foreground">
                                {content}
                            </Link>
                        ) : (
                            <span className="flex min-w-0 items-center gap-3">{content}</span>
                        )}
                        {number < onboardingStepLabels.length && (
                            <span aria-hidden="true" className={cn('h-px min-w-3 flex-1', done ? 'bg-primary' : 'bg-border')} />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
