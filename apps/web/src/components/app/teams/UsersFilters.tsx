'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';

export type UsersFilter = 'relationship' | 'team' | 'state';

/** The users list's filters (`?relationship=`, `?team=`, `?state=`); the page shows only those with something to tell apart */
export function UsersFilters({ teams, show }: { teams: { id: string; name: string }[]; show: UsersFilter[] }) {
    const params = useSearchParams(),
        pathname = usePathname(),
        router = useRouter();
    const filters = [
        {
            key: 'relationship',
            label: 'Relationship',
            options: [
                { id: 'all', name: 'All relationships' },
                { id: 'internal', name: 'Internal' },
                { id: 'external', name: 'External' },
                { id: 'unspecified', name: 'Unspecified' }
            ]
        },
        { key: 'team', label: 'Team', options: [{ id: 'all', name: 'All teams' }, ...teams] },
        {
            key: 'state',
            label: 'Invitation state',
            options: [
                { id: 'all', name: 'People and invitations' },
                { id: 'accepted', name: 'Accepted people' },
                { id: 'pending', name: 'Pending invitations' }
            ]
        }
    ];
    return filters.filter(filter => show.includes(filter.key as UsersFilter)).map((filter) => (
        <Select
            key={filter.key}
            items={filter.options.map(option => ({ value: option.id, label: option.name }))}
            value={params.get(filter.key) ?? 'all'}
            onValueChange={(value) => {
                const query = new URLSearchParams(params);
                if (!value || value === 'all') query.delete(filter.key);
                else query.set(filter.key, value);
                router.push(`${pathname}?${query}`);
            }}
        >
            <SelectTrigger aria-label={filter.label} size="sm" className="w-48">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {filter.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                            {option.name}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    ));
}
