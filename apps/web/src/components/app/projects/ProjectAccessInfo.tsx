'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import type { ProjectAccess } from '../../../lib/app/model';
import { AccessIcon, projectAccessLabels } from './projectLabels';

/** The project's comment access in the header; hover or click it for more info (and, for guests, the links) */
export function ProjectAccessInfo({ access, children }: { access: ProjectAccess; children?: ReactNode }) {
    const { label, description } = projectAccessLabels[access];
    const [open, setOpen] = useState(false);
    // Opened by a click stays open until dismissed; opened by hover closes when the pointer leaves
    const [pinned, setPinned] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(closeTimer.current), []);

    const hoverOpen = (event: React.PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(closeTimer.current);
        setOpen(true);
    };
    const hoverClose = (event: React.PointerEvent) => {
        if (event.pointerType !== 'mouse' || pinned) return;
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setOpen(false), 150);
    };
    const change = (next: boolean) => {
        clearTimeout(closeTimer.current);
        setOpen(next);
        setPinned(next);
    };

    return (
        <Popover open={open} onOpenChange={change}>
            <PopoverTrigger
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onPointerEnter={hoverOpen}
                onPointerLeave={hoverClose}
                onClick={event => {
                    // Clicking while hover-opened pins it instead of closing it
                    if (open && !pinned) {
                        event.preventDefault();
                        setPinned(true);
                    }
                }}>
                <AccessIcon access={access} className="size-4" aria-hidden="true" />
                {label}
                <InfoIcon className="size-3.5 text-muted-foreground" aria-label="More info" />
            </PopoverTrigger>
            <PopoverContent
                align="start"
                aria-label={label}
                className="w-80"
                onPointerEnter={hoverOpen}
                onPointerLeave={hoverClose}
                onOpenAutoFocus={event => { if (!pinned) event.preventDefault(); }}>
                <PopoverHeader>
                    <PopoverTitle>{label}</PopoverTitle>
                    <PopoverDescription>{description}</PopoverDescription>
                </PopoverHeader>
                {children}
            </PopoverContent>
        </Popover>
    );
}
