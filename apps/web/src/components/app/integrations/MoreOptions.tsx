'use client';

import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { useAppI18n } from '@/src/lib/i18n/client';

/**
 * The actions of a connection that people rarely need (reconnect, backfill, disconnect), closed until
 * asked for, so the card shows its state and the settings people change. Same trigger as Review's Advanced.
 */
export function MoreOptions({ children }: { children: ReactNode }) {
    const { t } = useAppI18n();
    return (
        <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/more h-auto self-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent" />}>
                <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-panel-open/more:rotate-90" />{t("More options")}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3">{children}</CollapsibleContent>
        </Collapsible>
    );
}
