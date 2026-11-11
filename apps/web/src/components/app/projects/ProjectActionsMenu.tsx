'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


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
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectStatus } from '../../../lib/app/model';
import { useInvite } from '../users/InviteDialog';
import { setProjectStatusAction } from './actions';

/** More actions of a project (admins): invite people, settings, install, mark as done or reopen */
export function ProjectActionsMenu({ projectId, projectName, status, className }: {
    projectId: string;
    projectName: string;
    status: ProjectStatus;
    className?: string;
}) {
    const { t } = useAppI18n();
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const openInvite = useInvite();

    const setStatus = (next: ProjectStatus) => startTransition(async () => {
        const result = await setProjectStatusAction(projectId, next);
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        toast.success(next === 'done' ? t("{value0} is marked as done.", { value0: projectName }) : t("{value0} is active again.", { value0: projectName }));
        router.refresh();
    });

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={pending} aria-label={t("More actions for {value0}", { value0: projectName })} className={className} />}>
                <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => openInvite(projectId)}>
                        <UserPlusIcon />{t("Invite people")}</DropdownMenuItem>
                    <DropdownMenuItem render={<Link href={KnownPageLinks.projectInstall(projectId)} />}>
                        <CodeIcon />{t("Install script")}</DropdownMenuItem>
                    <DropdownMenuItem render={<Link href={KnownPageLinks.projectSettings(projectId)} />}>
                        <SettingsIcon />{t("Settings")}</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {status === 'done' ? (
                        <DropdownMenuItem onClick={() => setStatus('active')}>
                            <Undo2Icon />{t("Reopen")}</DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem onClick={() => setStatus('done')}>
                            <CheckIcon />{t("Mark as done")}</DropdownMenuItem>
                    )}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
