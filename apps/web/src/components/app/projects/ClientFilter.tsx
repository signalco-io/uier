'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import type { ProjectStatus } from '@/src/lib/app/model';

/** Client names come only from projects the current member can see. */
export function ClientFilter({ clients, value, status }: { clients: string[]; value?: string; status: ProjectStatus }) {
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
                    {clients.map(client => <SelectItem key={client} value={`name:${client}`}>{client}</SelectItem>)}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
