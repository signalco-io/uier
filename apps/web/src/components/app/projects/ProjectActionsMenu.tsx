'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckIcon, CodeIcon, MoreHorizontalIcon, SettingsIcon, Undo2Icon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { KnownPageLinks, KnownPages } from '../../../knownPages';
import type { ProjectStatus } from '../../../lib/app/model';
import { setProjectStatusAction } from './actions';

/** More actions of a project (admins): invite people, settings, install, mark as done or reopen */
export function ProjectActionsMenu({ projectId, projectName, status, className }: {
    projectId: string;
    projectName: string;
    status: ProjectStatus;
    className?: string;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const setStatus = (next: ProjectStatus) => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        toast.success(next === 'done' ? `${projectName} is marked as done.` : `${projectName} is active again.`);
        router.refresh();
    });

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`More actions for ${projectName}`} className={className}>
                    <MoreHorizontalIcon />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                        <Link href={`${KnownPages.AppInviteUser}?project=${projectId}`}>
                            <UserPlusIcon />
                            Invite people
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href={KnownPageLinks.projectInstall(projectId)}>
                            <CodeIcon />
                            Install script
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href={KnownPageLinks.projectSettings(projectId)}>
                            <SettingsIcon />
                            Settings
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {status === 'done' ? (
                        <DropdownMenuItem onSelect={() => setStatus('active')}>
                            <Undo2Icon />
                            Reopen
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onSelect={() => setStatus('done')}>
                            <CheckIcon />
                            Mark as done
                        </DropdownMenuItem>
                    )}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
