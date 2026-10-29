'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FolderIcon } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';

const allProjects = 'all';

/** Filters the people by the project they can review (`?project=`) */
export function ProjectFilter({ projects, value }: { projects: { id: string; name: string }[]; value?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    return (
        <Select
            value={value ?? allProjects}
            onValueChange={next => { const query = new URLSearchParams(params); if (next === allProjects) query.delete('project'); else query.set('project', next); router.push(`${pathname}?${query}`); }}>
            <SelectTrigger size="sm" aria-label="Project" className="w-56">
                <FolderIcon className="text-muted-foreground" />
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectItem value={allProjects}>All projects</SelectItem>
                    {projects.map(project => (
                        <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
