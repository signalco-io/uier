'use client';

import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';
import type { SidebarCommentSummary, SidebarProject } from '@/src/lib/app/sidebarProjects';

/**
 * What the shell has already read about the workspace and its projects, for the loading states of the pages inside
 * it (docs/design/loading-states): a page that opens shows the project's name, the workspace's name and the links a
 * role decides at once, instead of placeholders for what the sidebar beside it already shows. Never a source of
 * truth: pages and actions still read and authorize for themselves.
 */
export type ShellInfo = {
    workspace: {
        name: string;
        /** An admin of this workspace */
        admin: boolean;
        /** uier's own feedback workspace, which every account joins and nobody configures */
        feedback: boolean;
        /** Whether it has teams, as far as an admin's shell reads them (`undefined` for everyone else) */
        teams?: boolean;
        /** One of the projects the person can see has a client: the projects list has its client filter then */
        clients: boolean;
    };
    /** The sign-in methods this deployment offers beside the email code and passkeys (its configuration, read per request) */
    signIn: { google: boolean; microsoft: boolean };
    /** The projects the person can see, by id */
    projects: Record<string, {
        id: string;
        publicId: string;
        name: string;
        /** Its first address, for `ProjectMark` */
        url?: string;
        status: 'active' | 'done';
        /** Unfinished, unarchived comments, where the sidebar counts them (listed projects only) */
        open?: number;
        /** Known to have a thread the person can see; `undefined` when the shell has not read that (not "none") */
        feedback?: true;
    }>;
};

const ShellInfoContext = createContext<ShellInfo | null>(null);
const SidebarProjectsContext = createContext<SidebarProject[]>([]);
const SidebarCommentUpdateContext = createContext<((projectId: string, userId: string, summary: SidebarCommentSummary) => void) | null>(null);

export function ShellInfoProvider({ value, projects, userId, readAt, children }: PropsWithChildren<{
    value: ShellInfo; projects: SidebarProject[]; userId: string; readAt: number;
}>) {
    const [updates, setUpdates] = useState<Record<string, SidebarCommentSummary>>({});
    const publish = useCallback((projectId: string, viewer: string, summary: SidebarCommentSummary) => {
        if (viewer !== userId || !Object.hasOwn(value.projects, projectId) || summary.readAt <= readAt) return;
        setUpdates(current => summary.readAt <= (current[projectId]?.readAt ?? 0) ? current : { ...current, [projectId]: summary });
    }, [userId, value.projects, readAt]);
    const hints = { ...value.projects };
    const listed = projects.map(project => {
        const summary = updates[project.id];
        if (!summary || summary.readAt <= readAt) return project;
        const { openCount, activityAt } = summary;
        hints[project.id] = { ...hints[project.id]!, open: openCount, feedback: activityAt > project.createdAt || undefined };
        return { ...project, openCount, activityAt };
    });
    return (
        <SidebarCommentUpdateContext.Provider value={publish}>
            <SidebarProjectsContext.Provider value={listed}>
                <ShellInfoContext.Provider value={{ ...value, projects: hints }}>{children}</ShellInfoContext.Provider>
            </SidebarProjectsContext.Provider>
        </SidebarCommentUpdateContext.Provider>
    );
}

export function useSidebarProjects() {
    return useContext(SidebarProjectsContext);
}

export function usePublishSidebarCommentSummary() {
    return useContext(SidebarCommentUpdateContext);
}

/** `null` outside the signed-in shell (and in the shell's own loading state) */
export function useShellInfo() {
    return useContext(ShellInfoContext);
}

/** Whether the person configures projects here: `projectSettingsContext`'s rule, from what the shell knows */
export function canConfigureProjects(info: ShellInfo | null) {
    return Boolean(info?.workspace.admin && !info.workspace.feedback);
}
