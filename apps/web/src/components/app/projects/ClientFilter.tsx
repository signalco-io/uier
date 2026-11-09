'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { urlWith } from '@/src/hooks/use-url-search-params';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import type { ClientSummary } from '@/src/lib/app/clients';

type FilterClient = Pick<ClientSummary, 'id' | 'name' | 'icon' | 'color' | 'logoUrl'>;

/** The client's mark, or an empty tile of the same size for All clients and No client so the names line up */
function FilterMark({ client }: { client?: FilterClient }) {
    return client
        ? <ClientMark client={client} />
        : <span aria-hidden="true" className="size-4 shrink-0 rounded-[4px] border border-dashed" />;
}

/**
 * Clients come only from projects the current member can see; the filter value is the client's id (or `none`).
 * The choice shows at once while the projects load, and the list keeps the status tab in the address.
 * Each client shows its `ClientMark`, in the menu and on the trigger.
 */
export function ClientFilter({ clients, value }: { clients: FilterClient[]; value?: string }) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [shown, setShown] = useOptimistic(value ?? 'all');
    const items = [{ value: 'all', label: 'All clients' }, { value: 'none', label: 'No client' }, ...clients.map(client => ({ value: client.id, label: client.name, client }))] as { value: string; label: string; client?: FilterClient }[];
    const itemOf = (selected: string | null) => items.find(item => item.value === selected);
    return (
        <Select items={items} value={shown} onValueChange={next => startTransition(() => {
            // Active and Done switch in the browser (`ProjectStatusTabs`): the address has the current one
            const { pathname, search } = urlWith({ client: next && next !== 'all' ? next : undefined });
            setShown(next ?? 'all');
            router.push(`${pathname}${search}`);
        })}>
            <SelectTrigger size="sm" aria-label="Client" className="w-56 max-w-full">
                <SelectValue>
                    {(selected: string | null) => {
                        const item = itemOf(selected);
                        return item && <><FilterMark client={item.client} />{item.label}</>;
                    }}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                            <FilterMark client={item.client} />
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
