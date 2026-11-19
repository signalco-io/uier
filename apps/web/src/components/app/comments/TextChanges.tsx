'use client';

import { hasTextChanges, textChanges } from '@uier/toolbar/change-proposal';
import { cn } from '@/src/lib/utils';
import { useAppI18n } from '@/src/lib/i18n/client';

/** Removed words are struck through, added ones underlined, so colour is never the only signal (as in the toolbar) */
const removedClass = 'rounded-sm bg-destructive/12 line-through decoration-destructive [box-decoration-break:clone] dark:bg-destructive/25';
const addedClass = 'rounded-sm bg-[hsl(var(--brand-success)/0.14)] underline decoration-[hsl(var(--brand-success))] underline-offset-2 [box-decoration-break:clone] dark:bg-[hsl(var(--brand-success)/0.22)]';

/** What a suggestion changes in the original text, as one inline diff, or that it changes no words */
export function TextChanges({ original, proposed, className }: { original: string; proposed: string; className?: string }) {
    const { t } = useAppI18n();
    const changes = textChanges(original, proposed);
    if (!hasTextChanges(changes))
        return <p className={cn('m-0 text-sm text-muted-foreground', className)} data-text-changes="none">{t('No text changes. The suggestion matches the original text.')}</p>;
    return <div className={cn('flex min-w-0 flex-col gap-1', className)}>
        <p className="m-0 text-xs font-medium text-muted-foreground">{t('Changes')}</p>
        <p className="m-0 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]" data-text-changes="">
            {changes.map((change, index) => change.type === 'same' ? change.text
                : change.type === 'removed'
                    ? <del key={index} className={removedClass}><span className="sr-only"> {t('Removed:')} </span>{change.text}</del>
                    : <ins key={index} className={cn(addedClass, changes[index - 1]?.type === 'removed' && 'ml-1')}>
                        <span className="sr-only"> {t('Added:')} </span>{change.text}
                    </ins>)}
        </p>
    </div>;
}
