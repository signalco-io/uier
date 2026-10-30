'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

/**
 * A quiet icon action in a comment's header (Mark as read, Copy issue, Copy link): the same
 * actions, icons and order as the toolbar's thread header. The tooltip names it; a notice
 * (Issue copied.) opens it under the button while set.
 */
export function ThreadAction({ label, tooltip = label, notice, disabled, busy, onClick, children }: {
    label: string;
    tooltip?: string;
    notice?: string;
    disabled?: boolean;
    busy?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    const [hovered, setHovered] = useState(false);
    // The notice keeps its text and side while it fades out; hovering again brings back the name
    const [shownNotice, setShownNotice] = useState(notice);
    if (notice && notice !== shownNotice)
        setShownNotice(notice);
    return (
        <Tooltip open={hovered || Boolean(notice)} onOpenChange={open => {
            setHovered(open);
            if (open && !notice)
                setShownNotice(undefined);
        }}>
            <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events: the span keeps its tooltip */}
                <span className="inline-flex">
                    <Button variant="ghost" size="icon-sm" aria-label={label} aria-busy={busy} disabled={disabled} onClick={onClick}
                        className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                        {children}
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent side={shownNotice ? 'bottom' : undefined}>{shownNotice ?? tooltip}</TooltipContent>
        </Tooltip>
    );
}
