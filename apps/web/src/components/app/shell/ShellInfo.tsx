'use client';

import { createContext, useContext, type PropsWithChildren } from 'react';

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

export function ShellInfoProvider({ value, children }: PropsWithChildren<{ value: ShellInfo }>) {
    return <ShellInfoContext.Provider value={value}>{children}</ShellInfoContext.Provider>;
}

/** `null` outside the signed-in shell (and in the shell's own loading state) */
export function useShellInfo() {
    return useContext(ShellInfoContext);
}

/** Whether the person configures projects here: `projectSettingsContext`'s rule, from what the shell knows */
export function canConfigureProjects(info: ShellInfo | null) {
    return Boolean(info?.workspace.admin && !info.workspace.feedback);
}
