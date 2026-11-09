'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { urlWith } from '@/src/hooks/use-url-search-params';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';

/**
 * Clients come only from projects the current member can see; the filter value is the client's id (or `none`).
 * The choice shows at once while the projects load, and the list keeps the status tab in the address.
 */
export function ClientFilter({ clients, value }: { clients: { id: string; name: string }[]; value?: string }) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [shown, setShown] = useOptimistic(value ?? 'all');
    const items = [{ value: 'all', label: 'All clients' }, { value: 'none', label: 'No client' }, ...clients.map(client => ({ value: client.id, label: client.name }))];
    return (
        <Select items={items} value={shown} onValueChange={next => startTransition(() => {
            // Active and Done switch in the browser (`ProjectStatusTabs`): the address has the current one
            const { pathname, search } = urlWith({ client: next && next !== 'all' ? next : undefined });
            setShown(next ?? 'all');
            router.push(`${pathname}${search}`);
        })}>
            <SelectTrigger size="sm" aria-label="Client" className="w-56 max-w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
