'use client';

import { ClipboardListIcon, PanelsTopLeftIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import type { ReproductionContext } from '../../../lib/comments/reproduction';
import { CopyBlock } from '../CopyBlock';

/** Authorized project members see only the server's allowlisted, original capture context. */
export function CommentReproduction({ context }: { context: ReproductionContext }) {
    return (
        <Collapsible className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <PanelsTopLeftIcon aria-hidden="true" className="size-4 shrink-0" />
                    {context.browser ?? 'Unknown browser'} · {context.os ?? 'Unknown OS'}
                </span>
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="xs" className="pointer-coarse:min-h-11">
                        <ClipboardListIcon aria-hidden="true" data-icon="inline-start" />
                        Reproduction details
                    </Button>
                </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="flex min-w-0 flex-col gap-2">
                <CopyBlock value={context.text} label="Copy reproduction details" />
                {context.url && <a href={context.url} target="_blank" rel="noopener" className="self-start text-xs underline">Reviewed page</a>}
            </CollapsibleContent>
        </Collapsible>
    );
}
