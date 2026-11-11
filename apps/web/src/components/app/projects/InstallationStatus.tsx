'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { RelativeTime } from '../comments/DateTime';

/**
 * A project whose site already sends feedback: informational only, with the time of the latest comment,
 * and the install guide (its children) behind a button
 */
export function InstallationStatus({ lastCommentAt, children }: { lastCommentAt: string; children: ReactNode }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    return (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-8">
            <Item variant="outline">
                <ItemMedia>
                    <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-success))]" />
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>{t("Feedback received")}</ItemTitle>
                    <ItemDescription>{t("Last comment")}{' '}<RelativeTime value={lastCommentAt} />{t(". This does not confirm that the script is installed.")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                    <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
                        {open ? t("Hide install guide") : t("Show install guide")}
                        <ChevronDownIcon data-icon="inline-end" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </CollapsibleTrigger>
                </ItemActions>
            </Item>
            <CollapsibleContent>{children}</CollapsibleContent>
        </Collapsible>
    );
}
