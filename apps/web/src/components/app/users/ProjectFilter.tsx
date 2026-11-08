'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FolderIcon } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';

const allProjects = 'all';

/** Filters the people by the project they can review (`?project=`); the choice shows at once while they load */
export function ProjectFilter({ projects, value }: { projects: { id: string; name: string }[]; value?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const [, startTransition] = useTransition();
    const [shown, setShown] = useOptimistic(value ?? allProjects);
    const items = [{ value: allProjects, label: 'All projects' }, ...projects.map(project => ({ value: project.id, label: project.name }))];
    return (
        <Select
            items={items}
            value={shown}
            onValueChange={next => startTransition(() => {
                const query = new URLSearchParams(params);
                if (!next || next === allProjects) query.delete('project'); else query.set('project', next);
                setShown(next ?? allProjects);
                router.push(`${pathname}?${query}`);
            })}>
            <SelectTrigger size="sm" aria-label="Project" className="w-56">
                <FolderIcon className="text-muted-foreground" />
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
