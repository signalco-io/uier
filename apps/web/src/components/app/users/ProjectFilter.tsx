'use client';

import { usePathname, useRouter } from 'next/navigation';
import { SelectItems } from '@signalco/ui-primitives/SelectItems';

const allProjects = 'all';

/** Filters the people by the project they can review (`?project=`) */
export function ProjectFilter({ projects, value }: { projects: { id: string; name: string }[]; value?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    return (
        <div className="w-64">
            <SelectItems
                label="Project"
                value={value ?? allProjects}
                onValueChange={(next) => router.push(next === allProjects ? pathname : `${pathname}?project=${encodeURIComponent(next)}`)}
                items={[
                    { value: allProjects, label: 'All projects' },
                    ...projects.map(project => ({ value: project.id, label: project.name }))
                ]} />
        </div>
    );
}
