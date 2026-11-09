'use client';

import { Button } from '../../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { RelativeTime } from './DateTime';

export function ThreadActivity({ entries }: { entries: ProjectCommentView['history'] }) {
    if (!entries?.length) return null;
    return <Collapsible className="min-w-0">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground pointer-coarse:min-h-11" />}>
            Activity ({entries.length})
        </CollapsibleTrigger>
        <CollapsibleContent>
            <ol aria-label="Thread activity" className="mt-2 max-h-64 space-y-3 overflow-y-auto text-xs text-muted-foreground">
                {entries.map(entry => <li key={entry.id} className="space-y-1 break-words">
                    <p>{entry.description}</p>
                    <span className="font-mono tabular-nums"><RelativeTime value={entry.at} /></span>
                </li>)}
            </ol>
        </CollapsibleContent>
    </Collapsible>;
}
