'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import type { ProjectAccess } from '../../../lib/app/model';
import { hoverPopoverTrigger } from '../hoverPopover';
import { AccessIcon, projectAccessLabels } from './projectLabels';

/**
 * The project's comment access in the header; hover it for more info (and, for guests, the links).
 * With `settingsHref` (those who can change it) it is a link to Who can comment in the settings;
 * without, a click opens the same info.
 */
export function ProjectAccessInfo({ access, settingsHref, children }: { access: ProjectAccess; settingsHref?: string; children?: ReactNode }) {
    const { t } = useAppI18n();
    const { label, description } = projectAccessLabels[access];
    const [open, setOpen] = useState(false);

    return (
        <Popover
            open={open}
            // A click on the link goes to the settings, it doesn't keep the info open over them
            onOpenChange={(next, details) => setOpen(next && !(settingsHref && details.reason === 'trigger-press'))}>
            <PopoverTrigger
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                {...(settingsHref ? { render: <Link href={settingsHref} />, nativeButton: false, role: 'link' } : {})}
                {...hoverPopoverTrigger}>
                <AccessIcon access={access} className="size-4" aria-hidden="true" />
                {t(label)}
            </PopoverTrigger>
            <PopoverContent align="start" aria-label={t(label)} className="w-80">
                <PopoverHeader>
                    <PopoverTitle>{t(label)}</PopoverTitle>
                    <PopoverDescription>{t(description)}</PopoverDescription>
                </PopoverHeader>
                {children}
            </PopoverContent>
        </Popover>
    );
}
