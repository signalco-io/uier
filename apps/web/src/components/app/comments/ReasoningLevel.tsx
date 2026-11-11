'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { SignalHighIcon, SignalIcon, SignalLowIcon, SignalMediumIcon, SignalZeroIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';

/** Signal bars for the levels agents commonly report; a level they do not know shows as text alone */
const levelIcons: Record<string, LucideIcon> = {
    none: SignalZeroIcon,
    minimal: SignalZeroIcon,
    low: SignalLowIcon,
    medium: SignalMediumIcon,
    high: SignalHighIcon,
    xhigh: SignalIcon,
    max: SignalIcon
};

/**
 * The reasoning level as signal bars and the level as the agent reported it ("medium"), without the word
 * "reasoning" on screen; a screen reader still reads "medium reasoning".
 */
export function ReasoningLevel({ level, className }: { level: string; className?: string }) {
    const { t } = useAppI18n();
    const Icon = levelIcons[level.trim().toLowerCase()];
    return <span data-agent-reasoning="" className={cn('inline-flex min-w-0 items-center gap-1', className)}>
        {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{level}</span>
        <span className="sr-only"> {t("reasoning")}</span>
    </span>;
}
