'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { SettingsIcon } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { NavigationPending } from '../NavigationPending';

/**
 * The project's settings, an icon button after Open review (in the project's layout); current in every
 * settings section and on the onboarding's install step
 */
export function ProjectSettingsLink({ href }: { href: string }) {
    const segment = useSelectedLayoutSegment();
    const current = segment === 'settings' || segment === 'install';
    return (
        <Tooltip>
            <TooltipTrigger render={<Link href={href} aria-label="Settings" aria-current={current ? 'page' : undefined} className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'aria-[current=page]:bg-muted')} />}>
                    <NavigationPending><SettingsIcon /></NavigationPending>
                </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
        </Tooltip>
    );
}
