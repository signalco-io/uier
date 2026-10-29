'use client';

import type { ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import type { ReproductionContext } from '../../../lib/comments/reproduction';
import { CopyBlock } from '../CopyBlock';

/**
 * The thread's quiet actions (`children`: Follow thread, Open in ...) with "Reproduction details"
 * after them; the details open under the row. Authorized project members see only the server's
 * allowlisted, original capture context.
 */
export function CommentReproduction({ context, children }: { context: ReproductionContext; children?: ReactNode }) {
    return (
        <Collapsible className="flex min-w-0 flex-col gap-2">
            <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                {children}
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="xs" className="group/reproduction font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
                        Reproduction details
                        <ChevronDownIcon aria-hidden="true" data-icon="inline-end" className="transition-transform group-data-open/reproduction:rotate-180" />
                    </Button>
                </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="flex min-w-0 flex-col gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground">
                <p className="m-0">{context.browser ?? 'Unknown browser'} · {context.os ?? 'Unknown OS'}</p>
                <CopyBlock value={context.text} label="Copy reproduction details" />
                {context.url && <a href={context.url} target="_blank" rel="noopener" className="self-start underline underline-offset-2 hover:text-foreground">Reviewed page</a>}
            </CollapsibleContent>
        </Collapsible>
    );
}
