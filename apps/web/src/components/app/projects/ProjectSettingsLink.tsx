'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
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
            <TooltipTrigger asChild>
                <Button variant="outline" size="icon" asChild className="aria-[current=page]:bg-muted">
                    <Link href={href} aria-label="Settings" aria-current={current ? 'page' : undefined}>
                        <NavigationPending><SettingsIcon /></NavigationPending>
                    </Link>
                </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
        </Tooltip>
    );
}
