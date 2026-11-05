import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { cn } from '@/src/lib/utils';
import { Section } from '../PageHeader';

/**
 * One onboarding step on its own card: what to do, then Back, Skip setup (leaves onboarding) and the
 * way forward (Next, or Finish on the last step). `next.primary` is false while the step's own action
 * (Check installation, Invite) is the one primary button.
 */
export function OnboardingStepCard({ id, title, description, back, skip, next, children }: {
    id: string;
    title: string;
    description?: ReactNode;
    back?: string;
    skip?: string;
    next: { href: string; label: string; primary?: boolean };
    children?: ReactNode;
}) {
    return (
        <Section
            id={id}
            title={title}
            description={description}
            footer={<>
                {back && <Link href={back} className={cn(buttonVariants({ variant: 'ghost' }), 'mr-auto')}>Back</Link>}
                {skip && <Link href={skip} className={buttonVariants({ variant: 'ghost' })}>Skip setup</Link>}
                <Link href={next.href} className={buttonVariants({ variant: next.primary === false ? 'outline' : 'default' })}>{next.label}</Link>
            </>}>
            <div className="flex flex-col gap-6">{children}</div>
        </Section>
    );
}
