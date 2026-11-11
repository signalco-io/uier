'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { Button } from '../../ui/button';
import { CardFooter } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { RelativeTime } from './DateTime';

/**
 * The open thread's footer: the kit's card footer under a divider (the darker band down to the card's
 * edge), holding the closed Activity section. The card has no vertical padding of its own, so the
 * footer's pull to the edge is cancelled.
 */
export function ThreadActivity({ entries }: { entries: ProjectCommentView['history'] }) {
    const { t } = useAppI18n();
    if (!entries?.length) return null;
    return <CardFooter className="block border-t px-4 [.border-t]:mb-0 [.border-t]:py-2">
        <Collapsible className="min-w-0">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground pointer-coarse:min-h-11" />}>
                {t("Activity ({count})", { count: entries.length })}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <ol aria-label={t("Thread activity")} className="mt-2 max-h-64 space-y-3 overflow-y-auto text-xs text-muted-foreground">
                    {entries.map(entry => <li key={entry.id} className="space-y-1 break-words">
                        <p>{entry.description}</p>
                        <span className="font-mono tabular-nums"><RelativeTime value={entry.at} /></span>
                    </li>)}
                </ol>
            </CollapsibleContent>
        </Collapsible>
    </CardFooter>;
}
