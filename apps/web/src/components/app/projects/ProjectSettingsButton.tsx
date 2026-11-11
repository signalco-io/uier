'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsIcon } from 'lucide-react';
import { buttonVariants } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { KnownPageLinks } from '@/src/knownPages';
import { cn } from '@/src/lib/utils';
import { isInstallPage } from './ProjectTabs';

/**
 * The project's settings: a cog right of Open review in the project header. It is current on the
 * settings pages, except the install guide while the Install tab is there to show it.
 */
export function ProjectSettingsButton({ projectId, installTab }: { projectId: string; installTab: boolean }) {
    const { t } = useAppI18n();
    const pathname = usePathname();
    const settings = KnownPageLinks.projectSettings(projectId);
    const current = (pathname === settings || pathname.startsWith(`${settings}/`)) && !(installTab && isInstallPage(pathname, projectId));
    return (
        <Tooltip>
            <TooltipTrigger
                render={(
                    <Link
                        href={settings}
                        aria-label={t("Settings")}
                        aria-current={current ? 'page' : undefined}
                        className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'aria-[current=page]:bg-muted aria-[current=page]:text-foreground dark:aria-[current=page]:bg-input/50')} />
                )}>
                <SettingsIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("Settings")}</TooltipContent>
        </Tooltip>
    );
}
