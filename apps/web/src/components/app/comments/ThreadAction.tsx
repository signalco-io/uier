'use client';

import type { ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

/**
 * A quiet icon action in a comment's header (Mark as read, Copy issue, Copy link): the same
 * actions, icons and order as the toolbar's thread header. The tooltip names it.
 */
export function ThreadAction({ label, tooltip = label, disabled, busy, onClick, children }: {
    label: string;
    tooltip?: string;
    disabled?: boolean;
    busy?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events: the span keeps its tooltip */}
                <span className="inline-flex">
                    <Button variant="ghost" size="icon-sm" aria-label={label} aria-busy={busy} disabled={disabled} onClick={onClick}
                        className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                        {children}
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    );
}
