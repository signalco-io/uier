'use client';

import { createContext, use, useState, type PropsWithChildren } from 'react';
import { UserPlusIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogContent } from '@/src/components/ui/dialog';
import type { ProjectStatus } from '../../../lib/app/model';
import { InviteForm } from './InviteForm';

const InviteContext = createContext<{ open: (projectId?: string, teamId?: string) => void; enabled: boolean } | null>(null);

/** Opens the invite dialog, optionally from a project (it is ticked and opens after accepting) */
export function useInvite() {
    const openInvite = use(InviteContext);
    if (!openInvite)
        throw new Error('useInvite needs an InviteProvider (the app shell)');
    return openInvite.open;
}

/**
 * The one invite dialog of the app shell, so inviting never leaves the page. Pages open it with
 * `InviteButton` or `useInvite()`; only admins see those (the action checks the role again).
 */
export function InviteProvider({ projects, teams = [], children, enabled = true }: PropsWithChildren<{
    enabled?: boolean;
    teams?: { id: string; name: string }[];
    projects: { id: string; name: string; status: ProjectStatus }[];
}>) {
    const [open, setOpen] = useState(false);
    const [fromProjectId, setFromProjectId] = useState<string>();
    const [fromTeamId, setFromTeamId] = useState<string>();
    // A new key starts the form over: each time the dialog opens, and for "Invite someone else"
    const [formKey, setFormKey] = useState(0);

    const openInvite = (projectId?: string, teamId?: string) => {
        setFromTeamId(teamId);
        if (!enabled) return;
        setFromProjectId(projectId);
        setFormKey(key => key + 1);
        setOpen(true);
    };

    return (
        <InviteContext value={{ open: openInvite, enabled }}>
            {children}
            <Dialog open={enabled && open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
                    <InviteForm
                        key={formKey}
                        teams={teams} fromTeamId={fromTeamId}
                        // Done projects stay out, unless the invitation starts from one
                        projects={projects.filter(project => project.status !== 'done' || project.id === fromProjectId).map(({ id, name }) => ({ id, name }))}
                        fromProjectId={projects.some(project => project.id === fromProjectId) ? fromProjectId : undefined}
                        onDone={() => setOpen(false)}
                        onInviteAnother={() => setFormKey(key => key + 1)} />
                </DialogContent>
            </Dialog>
        </InviteContext>
    );
}

/** The "Invite" button of the users page and a project's header */
export function InviteButton({ projectId, teamId, variant = 'default' }: { projectId?: string; teamId?: string; variant?: 'default' | 'outline' }) {
    const context = use(InviteContext);
    if (!context?.enabled) return null;
    return (
        <Button variant={variant} onClick={() => context.open(projectId, teamId)}>
            <UserPlusIcon data-icon="inline-start" />
            Invite
        </Button>
    );
}
