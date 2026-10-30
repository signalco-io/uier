'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import type { ProjectStatus } from '@/src/lib/app/model';

/** Clients come only from projects the current member can see; the filter value is the client's id (or `none`). */
export function ClientFilter({ clients, value, status }: { clients: { id: string; name: string }[]; value?: string; status: ProjectStatus }) {
    const router = useRouter();
    const pathname = usePathname();
    return (
        <Select value={value ?? 'all'} onValueChange={next => {
            const query = new URLSearchParams();
            if (status === 'done') query.set('status', status);
            if (next !== 'all') query.set('client', next);
            router.push(`${pathname}${query.size ? `?${query}` : ''}`);
        }}>
            <SelectTrigger size="sm" aria-label="Client" className="w-56 max-w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectItem value="all">All clients</SelectItem>
                    <SelectItem value="none">No client</SelectItem>
                    {clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
