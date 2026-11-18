
'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { cn } from '@/src/lib/utils';
import { Bar } from '../loading/outlines';
import { Section } from '../PageHeader';

/**
 * One onboarding step on its own card: what to do, then Back, Skip setup (leaves onboarding) and the
 * way forward (Next, or Finish on the last step). `next.primary` is false while the step's own action
 * (Check installation, Invite) is the one primary button. Without `next` its place is an outline: the step's
 * loading state, where the project decides whether the way forward is the primary button (`InstallStepLoading`).
 */
export function OnboardingStepCard({ id, title, description, back, skip, next, children }: {
    id: string;
    title: string;
    description?: ReactNode;
    back?: string;
    skip?: string;
    next?: { href: string; label: string; primary?: boolean };
    children?: ReactNode;
}) {
    const { t } = useAppI18n();
    return (
        <Section
            id={id}
            title={title}
            description={description}
            footer={<>
                {back && <Link href={back} className={cn(buttonVariants({ variant: 'ghost' }), 'mr-auto')}>{t("Back")}</Link>}
                {skip && <Link href={skip} className={buttonVariants({ variant: 'ghost' })}>{t("Skip setup")}</Link>}
                {next
                    ? <Link href={next.href} className={buttonVariants({ variant: next.primary === false ? 'outline' : 'default' })}>{t(next.label)}</Link>
                    : <Bar className="h-9 w-16 rounded-lg" />}
            </>}>
            <div className="flex flex-col gap-6">{children}</div>
        </Section>
    );
}
