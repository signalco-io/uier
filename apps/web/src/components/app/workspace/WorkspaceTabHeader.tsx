import type { ReactNode } from 'react';

/**
 * The top of a workspace tab: what the tab holds and its actions, then its filters. The area's header
 * above it has the workspace's name and the tabs, which name the page.
 */
export function WorkspaceTabHeader({ description, actions, children }: {
    description: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <p className="m-0 min-w-0 text-sm text-muted-foreground">{description}</p>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </div>
    );
}
