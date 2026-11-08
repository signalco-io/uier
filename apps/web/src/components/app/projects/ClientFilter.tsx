'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import type { ProjectStatus } from '@/src/lib/app/model';

/**
 * Clients come only from projects the current member can see; the filter value is the client's id (or `none`).
 * The choice shows at once while the projects load.
 */
export function ClientFilter({ clients, value, status }: { clients: { id: string; name: string }[]; value?: string; status: ProjectStatus }) {
    const router = useRouter();
    const pathname = usePathname();
    const [, startTransition] = useTransition();
    const [shown, setShown] = useOptimistic(value ?? 'all');
    const items = [{ value: 'all', label: 'All clients' }, { value: 'none', label: 'No client' }, ...clients.map(client => ({ value: client.id, label: client.name }))];
    return (
        <Select items={items} value={shown} onValueChange={next => startTransition(() => {
            const query = new URLSearchParams();
            if (status === 'done') query.set('status', status);
            if (next && next !== 'all') query.set('client', next);
            setShown(next ?? 'all');
            router.push(`${pathname}${query.size ? `?${query}` : ''}`);
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
