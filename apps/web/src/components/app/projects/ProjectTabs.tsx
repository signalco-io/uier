'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { KnownPageLinks } from '@/src/knownPages';
import { LinkTabs } from '../LinkTabs';
import { ProjectSettingsButton } from './ProjectSettingsButton';

/** Whether the page is the install guide: Settings → Installation, or the onboarding's install steps */
export function isInstallPage(pathname: string, projectId: string) {
    return pathname === KnownPageLinks.projectInstall(projectId) || pathname === `${KnownPageLinks.project(projectId)}/install`;
}

/**
 * A project's pages under its header: the comments, the page checks (what the toolbar's checks found on
 * each page members reviewed) and, until the site sends its first comment, the install guide (Settings →
 * Installation, and the onboarding's install step). Settings is a cog at the tabs' right end
 * (`ProjectSettingsButton`, uier #282), labelled where the row has room (uier #331).
 *
 * One underline slides from the current tab to the next, Settings too (uier #427): measured after hydration, it
 * replaces each tab's own underline, which shows until then. With reduced motion it moves without sliding.
 */
export function ProjectTabs({ projectId, install }: { projectId: string; install: boolean }) {
    const { t } = useAppI18n();
    const pathname = usePathname();
    const comments = KnownPageLinks.project(projectId);
    const pageChecks = KnownPageLinks.projectPageChecks(projectId);
    const rowRef = useRef<HTMLDivElement>(null);
    const [indicator, setIndicator] = useState<{ left: number; width: number; slide: boolean } | null>(null);
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row)
            return;
        const nav = row.querySelector('nav');
        const update = (slide: boolean) => {
            const current = row.querySelector<HTMLElement>('[aria-current="page"]');
            if (!current) {
                setIndicator(previous => previous && { ...previous, width: 0 });
                return;
            }
            // A tab half scrolled out of a narrow row underlines only its visible part
            const bounds = (nav?.contains(current) ? nav : row).getBoundingClientRect();
            const box = current.getBoundingClientRect();
            const start = Math.max(box.left, bounds.left);
            const width = Math.max(0, Math.min(box.right, bounds.right) - start);
            const left = start - row.getBoundingClientRect().left;
            // It slides only to a newly current tab: the first measurement (and one after no tab was current) places it,
            // and so does a scrolled or resized row, so it follows without lagging
            setIndicator(previous => previous?.left === left && previous.width === width
                ? previous
                : { left, width, slide: slide && Boolean(previous?.width) });
        };
        update(true);
        const follow = () => update(false);
        nav?.addEventListener('scroll', follow, { passive: true });
        const observer = new ResizeObserver(follow);
        observer.observe(row);
        if (nav)
            observer.observe(nav);
        return () => {
            nav?.removeEventListener('scroll', follow);
            observer.disconnect();
        };
    }, [pathname, install]);
    return (
        // The tabs' line runs to the panel's edges (uier #237), dividing the project's header from its page: a 1px
        // line whose shadow is clipped to its own row, so it adds no scrolling and the panel's frame clips it. The
        // tabs paint above it (a later positioned sibling), so the current tab's underline stays whole. Its width
        // decides whether Settings shows its label (`ProjectSettingsButton`). It sticks under the top bar while the page
        // scrolls (uier #413): below lg the window scrolls under the 3rem bar, from lg the panel scrolls under its own; its
        // background runs to the panel's edges like the line, so nothing shows through. As wide as the header above it.
        <div ref={rowRef} data-sticky-tabs="" data-tab-indicator={indicator ? '' : undefined} className="[&[data-tab-indicator]_[aria-current=page]]:border-b-transparent @container/project-tabs sticky top-12 z-10 bg-background shadow-[0_0_0_100vmax_hsl(var(--background))] [clip-path:inset(0_-100vmax)] lg:top-0 group-has-[[data-header-wide]]/project:page-wide flex items-center justify-between gap-4 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border before:shadow-[0_0_0_100vmax_hsl(var(--border))] before:[clip-path:inset(0_-100vmax)]">
            <LinkTabs
                label={t("Project")}
                className="relative min-w-0 flex-1"
                tabs={[
                    { href: comments, label: t("Comments"), current: pathname === comments },
                    { href: pageChecks, label: t("Page checks"), current: pathname === pageChecks },
                    ...install ? [{ href: KnownPageLinks.projectInstall(projectId), label: t("Install"), current: isInstallPage(pathname, projectId) }] : []
                ]} />
            <ProjectSettingsButton projectId={projectId} installTab={install} />
            {indicator && (
                <span
                    aria-hidden="true"
                    data-slot="tab-indicator"
                    className={`pointer-events-none absolute bottom-0 left-0 h-0.5 bg-foreground ${indicator.slide ? 'motion-safe:transition-[translate,width] motion-safe:duration-200 motion-safe:ease-out' : ''}`}
                    style={{ width: indicator.width, translate: `${indicator.left}px 0` }} />
            )}
        </div>
    );
}
