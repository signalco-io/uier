'use client';

import { SparklesIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

/**
 * The open thread's title when AI wrote one (`ProjectCommentView.title`), above its details. Without
 * one there is no heading: the first message shows in full below either way.
 */
export function ThreadTitle({ title }: { title?: string }) {
    if (!title) return null;
    return (
        <div className="flex min-w-0 items-start gap-1.5">
            <h2 className="m-0 min-w-0 text-base font-semibold break-words">{title}</h2>
            <Tooltip>
                <TooltipTrigger render={<span role="img" aria-label="Title written by AI" className="mt-1 inline-flex shrink-0 text-muted-foreground" />}>
                    <SparklesIcon aria-hidden="true" className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Written by AI from the first message</TooltipContent>
            </Tooltip>
        </div>
    );
}
