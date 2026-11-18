'use client';

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { SearchIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPages } from '@/src/knownPages';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import { LinkTabs } from '../LinkTabs';
import { useShellInfo } from '../shell/ShellInfo';
import { TeamEditor } from '../teams/TeamEditor';
import { WorkspaceTabHeader } from './WorkspaceTabHeader';
import { managesWorkspace } from './workspaceTabs';

/**
 * The top of the Teams tab: what it holds, its two actions, then the Active and Archived filter and the search. All
 * of it follows the address alone, so it sits outside the list's data boundary: real at once, and what is typed or
 * opened in it stays when the list arrives (docs/design/loading-states #18).
 *
 * `group` is the body of Group existing people, which lists the workspace's people and projects: the page streams it
 * in its own boundary. The page is for those who manage the workspace and says so itself (404); the toolbar is not
 * shown to anyone the shell knows is not one.
 */
export function TeamsToolbar({ group }: { group: ReactNode }) {
    const { t } = useAppI18n();
    const workspace = useShellInfo()?.workspace;
    const params = useSearchParams();
    if (workspace && !managesWorkspace(workspace))
        return null;
    const state = params.get('state') === 'archived' ? 'archived' : 'active';
    const search = params.get('q')?.trim() || undefined;
    const stateHref = (value: 'active' | 'archived') => {
        const query = new URLSearchParams();
        if (value === 'archived') query.set('state', value);
        if (search) query.set('q', search);
        return `${KnownPages.AppTeams}${query.size ? `?${query}` : ''}`;
    };
    return (
        <WorkspaceTabHeader
            description={t("Share selected projects with a group of people. Archived teams grant no access.")}
            actions={(
                <>
                    {/* A team of people already in the workspace, with its projects: an occasional, longer flow */}
                    <Dialog>
                        <DialogTrigger render={<Button variant="outline" />}>{t("Group existing people")}</DialogTrigger>
                        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle>{t("Group existing people into a team")}</DialogTitle>
                                <DialogDescription>{t("Choose people already in the workspace and the projects the team shares. Their own access stays.")}</DialogDescription>
                            </DialogHeader>
                            {group}
                        </DialogContent>
                    </Dialog>
                    {/* Always here, never in the empty list: the dialog says "Open team" after the first team replaces that list */}
                    <TeamEditor />
                </>
            )}>
            <div className="flex flex-wrap items-center gap-3">
                <LinkTabs
                    label="Team status"
                    variant="segmented"
                    tabs={[
                        { href: stateHref('active'), label: 'Active', current: state === 'active' },
                        { href: stateHref('archived'), label: 'Archived', current: state === 'archived' }
                    ]} />
                {/* Searches the selected tab; Enter submits */}
                <form role="search" className="w-full sm:w-64">
                    {state === 'archived' && <input type="hidden" name="state" value={state} />}
                    <InputGroup className="h-8">
                        <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
                        {/* `/` goes here from the page (`AppShortcuts`). Keyed by the address's search, so Back and Forward show theirs */}
                        <InputGroupInput key={search ?? ''} type="search" name="q" defaultValue={search} maxLength={80}
                            aria-label={t("Search teams")} placeholder={t("Search teams")} data-shortcut-search="" />
                    </InputGroup>
                </form>
            </div>
        </WorkspaceTabHeader>
    );
}
