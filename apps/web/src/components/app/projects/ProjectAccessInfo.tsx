'use client';

import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import type { ProjectAccess } from '../../../lib/app/model';
import { useHoverPopover } from '../useHoverPopover';
import { AccessIcon, projectAccessLabels } from './projectLabels';

/** The project's comment access in the header; hover or click it for more info (and, for guests, the links) */
export function ProjectAccessInfo({ access, children }: { access: ProjectAccess; children?: ReactNode }) {
    const { label, description } = projectAccessLabels[access];
    const popover = useHoverPopover();

    return (
        <Popover {...popover.root}>
            <PopoverTrigger
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                {...popover.trigger}>
                <AccessIcon access={access} className="size-4" aria-hidden="true" />
                {label}
                <InfoIcon className="size-3.5 text-muted-foreground" aria-label="More info" />
            </PopoverTrigger>
            <PopoverContent align="start" aria-label={label} className="w-80" {...popover.content}>
                <PopoverHeader>
                    <PopoverTitle>{label}</PopoverTitle>
                    <PopoverDescription>{description}</PopoverDescription>
                </PopoverHeader>
                {children}
            </PopoverContent>
        </Popover>
    );
}
