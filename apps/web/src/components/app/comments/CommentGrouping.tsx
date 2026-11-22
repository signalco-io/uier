'use client';

import { LayersIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ThreadLabel } from '@/src/lib/app/threadLabel';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { filterIconButton } from './CommentsViewToggle';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem, DropdownMenuItem } from '@/src/components/ui/dropdown-menu';

export function CommentGrouping({ labels, selected, disabled, onChange, review, onReviewChange }: {
    labels: ThreadLabel[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void;
    review?: boolean; onReviewChange?: (enabled: boolean) => void;
}) {
    const { t } = useAppI18n();
    return <DropdownMenu>
        {/* Icon-only and without an outline, like Filter beside it (uier #404); the tooltip and its name say what it is */}
        <Tooltip>
            <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('Group by')} className={filterIconButton} disabled={disabled && !onReviewChange} />} />}>
                <LayersIcon />
            </TooltipTrigger>
            <TooltipContent>{t('Group by')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={disabled && !review} onClick={() => review ? onReviewChange?.(false) : onChange([])}>{t('No grouping')}</DropdownMenuItem>
            {onReviewChange && <DropdownMenuCheckboxItem checked={review} onCheckedChange={onReviewChange} closeOnClick
                className="pointer-coarse:min-h-11">{t('Review session')}</DropdownMenuCheckboxItem>}
            <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={disabled}>{t('Label')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                    {labels.length ? labels.map(label => <DropdownMenuCheckboxItem key={label.id} disabled={disabled} checked={selected.includes(label.id)} closeOnClick={false} className="pointer-coarse:min-h-11"
                        onCheckedChange={checked => onChange(checked ? [...selected, label.id] : selected.filter(id => id !== label.id))}>{label.name}</DropdownMenuCheckboxItem>)
                        : <DropdownMenuItem disabled>{t('No labels')}</DropdownMenuItem>}
                </DropdownMenuSubContent>
            </DropdownMenuSub>
        </DropdownMenuContent>
    </DropdownMenu>;
}
