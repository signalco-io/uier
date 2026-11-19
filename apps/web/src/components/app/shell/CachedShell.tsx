'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Separator } from '@/src/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/src/components/ui/sidebar';
import { TooltipProvider } from '@/src/components/ui/tooltip';
import { getShellSwitch, readCurrentShell, subscribeShellSwitch, type CachedShellView } from '@/src/lib/app/shellCache';
import { CachedAppI18nProvider } from '@/src/lib/i18n/client';
import { Bar, HeaderOutline } from '../loading/outlines';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { AppSidebar } from './AppSidebar';
import { CachedShellContext } from './cachedShellContext';
import { shellColumnClassName, shellInsetClassName, shellScrollClassName, shellTopBarClassName } from './ShellFrame';

/** The live shell is in the document (streamed in, or rendered by a navigation) */
const liveShellSelector = '[data-app-shell]';

/**
 * The copy of the shell this browser kept (`shellCache`), drawn in place of `ShellFrame` while the server reads the
 * request: the workspace, the projects with their favicons and the account as they were last time, in the app's
 * language. Also drawn over the live shell while a workspace or account switch opens the destination, when this
 * browser has its copy. The same components as the live shell at the same sizes, so nothing moves when it takes over;
 * inert and hidden from assistive technology like the frame (its status stays the frame's), and never a source of truth.
 *
 * It sits beside the shell's Suspense boundary, not in its fallback: a streamed fallback is never hydrated, so a
 * component in it would never read the database. The CSS in `global.css` hides the frame while the copy draws and
 * the copy as soon as the live shell is in the document, before this component has seen it.
 */
export function CachedShell() {
    const switching = useSyncExternalStore(subscribeShellSwitch, getShellSwitch, () => undefined);
    const [initial, setInitial] = useState<CachedShellView>();
    const [live, setLive] = useState(false);

    useEffect(() => {
        if (document.querySelector(liveShellSelector)) {
            setLive(true);
            return;
        }
        let cancelled = false;
        // Removed from the document the moment the live shell arrives, so the two are never there together for long
        const observer = new MutationObserver(() => {
            if (document.querySelector(liveShellSelector)) {
                observer.disconnect();
                setLive(true);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        void readCurrentShell().then(view => {
            if (!cancelled && view && !document.querySelector(liveShellSelector))
                setInitial(view);
        });
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, []);

    const view = switching?.view ?? (live ? undefined : initial);
    return view ? <CachedShellView view={view} switching={Boolean(switching)} /> : null;
}

function CachedShellView({ view, switching }: { view: CachedShellView; switching: boolean }) {
    const { snapshot, catalog } = view;
    const { sidebar } = snapshot;
    const breadcrumbs = Object.fromEntries(sidebar.projects.flatMap(project =>
        [project.id, project.publicId].filter((id): id is string => Boolean(id)).map(id => [id, { id: project.id, name: project.name, url: project.url }])));
    return (
        <CachedShellContext.Provider value>
            <CachedAppI18nProvider language={snapshot.language} catalog={catalog}>
                <TooltipProvider delay={300}>
                    <SidebarProvider inert aria-hidden="true" data-cached-shell="" data-switching={switching ? '' : undefined} defaultOpen={!view.collapsed}>
                        <AppSidebar {...sidebar} />
                        <SidebarInset className={shellInsetClassName}>
                            <header className={shellTopBarClassName}>
                                <SidebarTrigger tabIndex={-1} />
                                <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
                                {/* A switch leaves the page it was on: the destination's crumbs come with it */}
                                {switching ? <Bar className="h-4 w-28" /> : <AppBreadcrumbs projects={breadcrumbs} />}
                            </header>
                            <div className={shellScrollClassName}>
                                <div className={shellColumnClassName}>
                                    <HeaderOutline />
                                </div>
                            </div>
                        </SidebarInset>
                    </SidebarProvider>
                </TooltipProvider>
            </CachedAppI18nProvider>
        </CachedShellContext.Provider>
    );
}
