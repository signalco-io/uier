'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { SettingsIcon } from 'lucide-react';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/src/components/ui/popover';
import type { ProjectAccess } from '../../../lib/app/model';
import { LinkPopover } from '../LinkPopover';
import { AccessIcon, projectAccessLabels } from './projectLabels';

/**
 * The project's comment access in the header; hover or focus it for more info: the guest links for guests,
 * and for admins Invite. With `href` (those who configure the project) it is a link: to People and teams
 * when only invited people comment, else to Who can comment (`accessHref`, also in the popover); without,
 * a click opens the info.
 */
export function ProjectAccessInfo({ access, href, accessHref, children }: {
    access: ProjectAccess;
    href?: string;
    /** Who can comment in the project's settings, for those who change it */
    accessHref?: string;
    children?: ReactNode;
}) {
    const { t } = useAppI18n();
    const { label, description } = projectAccessLabels[access];
    return (
        <LinkPopover
            href={href}
            label={t(label)}
            trigger={(
                <>
                    <AccessIcon access={access} className="size-4" aria-hidden="true" />
                    {t(label)}
                </>
            )}>
            <PopoverHeader>
                <PopoverTitle>{t(label)}</PopoverTitle>
                <PopoverDescription>{t(description)}</PopoverDescription>
            </PopoverHeader>
            {children}
            {accessHref && (
                <Link href={accessHref} className="flex items-center gap-1.5 self-start rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    <SettingsIcon aria-hidden="true" className="size-4" />
                    {t("Who can comment")}
                </Link>
            )}
        </LinkPopover>
    );
}
