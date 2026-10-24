'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@signalco/ui-primitives/Menu';
import { showNotification } from '@signalco/ui-notifications';
import { Check, Code, MoreHorizontal, Settings, Undo } from '@signalco/ui-icons';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectStatus } from '../../../lib/app/model';
import { setProjectStatusAction } from './actions';

/** More actions of a project (admins): settings, install, mark as done or reopen */
export function ProjectActionsMenu({ projectId, projectName, status }: { projectId: string; projectName: string; status: ProjectStatus }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const setStatus = (next: ProjectStatus) => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok) {
            showNotification(result.error, 'error');
            return;
        }
        showNotification(next === 'done' ? `${projectName} is marked as done.` : `${projectName} is active again.`, 'success');
        router.refresh();
    });

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <IconButton variant="plain" size="sm" disabled={pending} aria-label={`More actions for ${projectName}`} title="More actions">
                    <MoreHorizontal />
                </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem href={KnownPageLinks.projectSettings(projectId)} startDecorator={<Settings className="size-4" />}>
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem href={KnownPageLinks.projectInstall(projectId)} startDecorator={<Code className="size-4" />}>
                    Install script
                </DropdownMenuItem>
                {status === 'done' ? (
                    <DropdownMenuItem startDecorator={<Undo className="size-4" />} onSelect={() => setStatus('active')}>
                        Reopen
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem startDecorator={<Check className="size-4" />} onSelect={() => setStatus('done')}>
                        Mark as done
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
