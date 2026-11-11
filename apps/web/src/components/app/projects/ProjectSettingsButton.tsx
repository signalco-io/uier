'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { KnownPageLinks } from '@/src/knownPages';
import { isInstallPage } from './ProjectTabs';

/**
 * The project's settings: a small cog at the right end of the project's tabs (uier #282), quiet like a tab and
 * underlined like the current one on the settings pages, except the install guide while the Install tab is there to
 * show it. Its name and tooltip say Settings.
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
                        className="relative inline-flex h-10 w-8 shrink-0 items-center justify-center border-b-2 border-transparent text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:border-foreground aria-[current=page]:text-foreground pointer-coarse:w-11" />
                )}>
                <SettingsIcon aria-hidden="true" className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{t("Settings")}</TooltipContent>
        </Tooltip>
    );
}
