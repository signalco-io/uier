'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { ArrowUpDownIcon } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { SidebarGroupAction } from '@/src/components/ui/sidebar';
import { cn } from '@/src/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { projectGroupings, projectSorts, type ProjectGrouping, type ProjectOrder, type ProjectSort } from '@/src/lib/app/projectOrder';

const sortLabels: Record<ProjectSort, string> = {
    recent: 'Recent activity',
    created: 'Recently created',
    alphabetical: 'Name'
};

const groupLabels: Record<ProjectGrouping, string> = {
    none: 'None',
    client: 'Client',
    status: 'Status'
};

/**
 * The projects header's menu: Sort (recent activity, recently created or name) and Group (none, client once an
 * active project has one, or status, which lists the done projects too), each one choice. The menu stays open after
 * a choice, so both can be changed at once. The icon takes the group label's colour (`text-sidebar-foreground/70`).
 */
export function ProjectOrderMenu({ order, onChange, canGroupByClient, className }: {
    order: ProjectOrder;
    onChange: (order: ProjectOrder) => void;
    /** Whether an active project has a client to group by */
    canGroupByClient: boolean;
    className?: string;
}) {
    const { t, language } = useAppI18n();
    const groupings = projectGroupings.filter(group => group !== 'client' || canGroupByClient);
    // Grouped by client without any client, the list is not grouped: show that
    const group = groupings.includes(order.group) ? order.group : "none";
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger render={<DropdownMenuTrigger render={<SidebarGroupAction className={cn('text-sidebar-foreground/70', className)} />} />}>
                    <ArrowUpDownIcon />
                    <span className="sr-only">{t("Sort and group projects")}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t("Sort and group projects")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuRadioGroup value={order.sort} onValueChange={(sort: ProjectSort) => onChange({ ...order, sort })}>
                    <DropdownMenuLabel>{t("Sort")}</DropdownMenuLabel>
                    {projectSorts.map(sort => (
                        <DropdownMenuRadioItem key={sort} value={sort}>{sortLabels[sort]}</DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={group} onValueChange={(next: ProjectGrouping) => onChange({ ...order, group: next })}>
                    <DropdownMenuLabel>{t("Group")}</DropdownMenuLabel>
                    {groupings.map(grouping => (
                        <DropdownMenuRadioItem key={grouping} value={grouping}>{groupLabels[grouping]}</DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
