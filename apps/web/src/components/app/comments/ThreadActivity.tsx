'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';

import { Button } from '../../ui/button';
import { CardFooter } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { RelativeTime } from './DateTime';

/**
 * The open thread's footer: the kit's card footer under a divider (the darker band down to the card's
 * edge), holding the closed Activity section. The card has no vertical padding of its own, so the
 * footer's pull to the edge is cancelled. The entries read as a timeline, newest first (uier #486): history
 * is stored in write order, so it is reversed. A hairline rail joins the entries' rings; the newest ring is filled.
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
                <ol aria-label={t("Thread activity")} className="mt-2 max-h-64 overflow-y-auto text-xs">
                    {[...entries].reverse().map((entry, index) => <li key={entry.id} className="relative grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0">
                        <span aria-hidden className={cn('mt-1 size-2 rounded-full border', index === 0 ? 'border-foreground bg-foreground' : 'border-muted-foreground')} />
                        {index < entries.length - 1 && <span aria-hidden className="absolute top-4 bottom-0 left-[calc(0.25rem-0.5px)] w-px bg-muted-foreground/40" />}
                        <div className="space-y-0.5 break-words">
                            <p className={index === 0 ? 'text-foreground' : 'text-muted-foreground'}>{entry.description}</p>
                            <span className="font-mono text-muted-foreground tabular-nums"><RelativeTime value={entry.at} /></span>
                        </div>
                    </li>)}
                </ol>
            </CollapsibleContent>
        </Collapsible>
    </CardFooter>;
}
