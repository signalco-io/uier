'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

/** The project's settings, an icon button after Open review; current on the settings and install pages */
export function ProjectSettingsLink({ href, installHref }: { href: string; installHref: string }) {
    const pathname = usePathname();
    const current = pathname === href || pathname === installHref;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="outline" size="icon" asChild className="aria-[current=page]:bg-muted">
                    <Link href={href} aria-label="Settings" aria-current={current ? 'page' : undefined}>
                        <SettingsIcon />
                    </Link>
                </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
        </Tooltip>
    );
}
