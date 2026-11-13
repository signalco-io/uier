'use client';

import { LayersIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ThreadLabel } from '@/src/lib/app/threadLabel';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem, DropdownMenuItem } from '@/src/components/ui/dropdown-menu';

export function CommentGrouping({ labels, selected, disabled, onChange }: { labels: ThreadLabel[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
    const { t } = useAppI18n();
    return <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="shrink-0 pointer-coarse:min-h-11" disabled={disabled} />}>
            <LayersIcon data-icon="inline-start" />{t('Group by')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={disabled} onClick={() => onChange([])}>{t('No grouping')}</DropdownMenuItem>
            <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t('Label')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                    {labels.length ? labels.map(label => <DropdownMenuCheckboxItem key={label.id} disabled={disabled} checked={selected.includes(label.id)} closeOnClick={false} className="pointer-coarse:min-h-11"
                        onCheckedChange={checked => onChange(checked ? [...selected, label.id] : selected.filter(id => id !== label.id))}>{label.name}</DropdownMenuCheckboxItem>)
                        : <DropdownMenuItem disabled>{t('No labels')}</DropdownMenuItem>}
                </DropdownMenuSubContent>
            </DropdownMenuSub>
        </DropdownMenuContent>
    </DropdownMenu>;
}
