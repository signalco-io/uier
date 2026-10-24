'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { SelectItems } from '@signalco/ui-primitives/SelectItems';
import { showNotification } from '@signalco/ui-notifications';
import { FormMessage } from '../FormMessage';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import type { ProjectAccess, ProjectStatus } from '../../../lib/app/model';
import { UrlListInput } from './UrlListInput';
import { projectAccessLabels } from './projectLabels';
import { setProjectStatusAction, updateProjectAccessAction, updateProjectNameAction, updateProjectUrlsAction } from './actions';

export function ProjectNameForm({ projectId, name }: { projectId: string; name: string }) {
    const [state, formAction, pending] = useActionState(updateProjectNameAction, null);
    const [value, setValue] = useState(name);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="projectId" value={projectId} />
            <Input
                label="Project name"
                name="name"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
                maxLength={MAX_PROJECT_NAME_LENGTH}
                fullWidth />
            <FormMessage state={state} />
            <Button type="submit" variant="solid" className="self-start" loading={pending}>Save</Button>
        </form>
    );
}

export function ProjectUrlsForm({ projectId, urls }: { projectId: string; urls: string[] }) {
    const [state, formAction, pending] = useActionState(updateProjectUrlsAction, null);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="projectId" value={projectId} />
            {/* Remounted with the saved (normalized) addresses */}
            <UrlListInput key={urls.join(' ')} defaultUrls={urls} />
            <FormMessage state={state} />
            <Button type="submit" variant="solid" className="self-start" loading={pending}>Save</Button>
        </form>
    );
}

const accessItems = (['invited', 'guests', 'disabled'] as const).map(access => ({
    value: access,
    label: projectAccessLabels[access].label
}));

export function ProjectAccessForm({ projectId, access }: { projectId: string; access: ProjectAccess }) {
    const [state, formAction, pending] = useActionState(updateProjectAccessAction, null);
    const [value, setValue] = useState<ProjectAccess>(access);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="access" value={value} />
            <div className="flex flex-col gap-2">
                <SelectItems
                    label="Who can comment"
                    value={value}
                    onValueChange={(next) => setValue(next as ProjectAccess)}
                    items={accessItems} />
                {/* Not the kit's helperText: it is styled as an error */}
                <p className="m-0 text-sm text-muted-foreground">{projectAccessLabels[value].description}</p>
            </div>
            <FormMessage state={state} />
            <Button type="submit" variant="solid" className="self-start" loading={pending}>Save</Button>
        </form>
    );
}

export function ProjectStatusButton({ projectId, status }: { projectId: string; status: ProjectStatus }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const next: ProjectStatus = status === 'done' ? 'active' : 'done';

    const handleClick = () => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok) {
            showNotification(result.error, 'error');
            return;
        }
        router.refresh();
    });

    return (
        <Button variant="outlined" className="self-start" loading={pending} onClick={handleClick}>
            {status === 'done' ? 'Reopen project' : 'Mark as done'}
        </Button>
    );
}
