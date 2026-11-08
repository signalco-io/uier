'use client';

import { ArrowUpDownIcon } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { SidebarGroupAction } from '@/src/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { projectSorts, type ProjectOrder, type ProjectSort } from '@/src/lib/app/projectOrder';

const sortLabels: Record<ProjectSort, string> = {
    recent: 'Recent activity',
    alphabetical: 'Alphabetical'
};

/**
 * The active projects header's sort menu: by recent activity or by name, and, once a project has a client,
 * grouped under the clients. The choices stay open in the menu, so both can be changed at once.
 */
export function ProjectOrderMenu({ order, onChange, canGroup, className }: {
    order: ProjectOrder;
    onChange: (order: ProjectOrder) => void;
    /** Whether a listed project has a client to group by */
    canGroup: boolean;
    className?: string;
}) {
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger render={<DropdownMenuTrigger render={<SidebarGroupAction className={className} />} />}>
                    <ArrowUpDownIcon />
                    <span className="sr-only">Sort projects</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">Sort projects</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuRadioGroup value={order.sort} onValueChange={(sort: ProjectSort) => onChange({ ...order, sort })}>
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    {projectSorts.map(sort => (
                        <DropdownMenuRadioItem key={sort} value={sort}>{sortLabels[sort]}</DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                {canGroup && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuCheckboxItem checked={order.groupByClient} onCheckedChange={groupByClient => onChange({ ...order, groupByClient })}>
                                Group by client
                            </DropdownMenuCheckboxItem>
                        </DropdownMenuGroup>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
