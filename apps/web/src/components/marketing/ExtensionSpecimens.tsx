import type { ReactNode } from 'react';
import { Check, ExternalLink, Globe, LogOut } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Logo } from '@uier/brand/Logo';
import { Mark } from '@uier/brand/Mark';
import { Pin } from '@uier/brand/Pin';
import { extensionRelease } from '../../lib/extension/release';
import { ToolbarIllustration } from '../brand/ToolbarIllustration';
import { Avatar, floating } from './LandingSpecimens';

// Static pictures of the browser extension for /browser-extension: its popup (packages/extension/src/popup.tsx,
// the "Review this site" state with two matching projects) and the review toolbar it starts
// (ToolbarIllustration, packages/toolbar CommentToolbar expanded). Built from the tokens like the landing specimens, never
// screenshots; hidden from assistive technologies, since the captions and steps say the same. Recheck
// them with the popup and the toolbar. The example site is the landing page's imaginary restaurant.

const site = 'staging.example.com';

/** A browser window with the extension's button beside the address bar */
function BrowserFrame({ active, children }: { active?: boolean; children: ReactNode }) {
    return (
        <div className={cx('rounded-3xl border bg-card p-2', floating)}>
            <div className="flex items-center gap-1.5 px-2 pb-2.5 pt-1">
                <span className="size-2.5 shrink-0 rounded-full bg-muted" />
                <span className="size-2.5 shrink-0 rounded-full bg-muted" />
                <span className="size-2.5 shrink-0 rounded-full bg-muted" />
                <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1 font-mono text-[13px] text-muted-foreground">{site}/menu</span>
                <span className={cx('inline-flex size-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-muted text-foreground' : 'text-muted-foreground')}>
                    <Mark size={16} />
                </span>
            </div>
            {/* data-uier-decorative: the toolbar's screenshots keep this box but not its content; the
                min-height keeps its size there, as screenshots do not copy heights */}
            <div data-uier-decorative="" className="relative h-[350px] min-h-[350px] overflow-hidden rounded-2xl border bg-background p-6">
                {children}
            </div>
        </div>
    );
}

/** The example site's page */
function SitePage({ pinned }: { pinned?: boolean }) {
    return (
        <>
            <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Trattoria</span>
                <span className="flex gap-4 text-xs text-muted-foreground"><span>Menu</span><span>Visit</span><span>Book</span></span>
            </div>
            <div className="mt-10 text-[26px] font-semibold leading-tight tracking-[-0.03em]">
                Fresh pasta,{' '}
                <span className={cx('relative', pinned && 'rounded-[3px] bg-[hsl(var(--brand-selection))]')}>
                    every day.
                    {pinned && <Pin number={15} messages={2} size={26} className="absolute left-full top-full -ml-1 -mt-2" />}
                </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Lunch from noon, dinner until late.</p>
            <span className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Book a table</span>
        </>
    );
}

/** The popup with two projects that include this address, one chosen */
function Popup() {
    const projects = [{ name: 'Trattoria website', selected: true }, { name: 'Trattoria booking' }];
    return (
        <div className={cx('flex w-[272px] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground', floating)}>
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
                <Logo size={16} />
                <span className="text-[11px] text-muted-foreground">Browser extension</span>
            </div>
            <div className="flex flex-col gap-3 p-3.5">
                <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold tracking-[-0.01em]">Review this site</span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Globe size={14} strokeWidth={1.75} className="shrink-0" />
                        <span className="truncate font-mono text-[12px]">{site}</span>
                    </span>
                </div>
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Choose a project</span>
                    <div className="flex flex-col overflow-hidden rounded-lg border">
                        {projects.map((project, index) => (
                            <span key={project.name} className={cx('flex h-9 items-center justify-between gap-2 px-3 text-[13px]', index > 0 && 'border-t', project.selected && 'bg-muted')}>
                                <span className="truncate">{project.name}</span>
                                <Check size={14} strokeWidth={1.75} className={project.selected ? 'shrink-0' : 'shrink-0 opacity-0'} />
                            </span>
                        ))}
                    </div>
                </div>
                <span className="inline-flex h-8 items-center justify-center rounded-md bg-primary text-[13px] font-medium text-primary-foreground">{extensionRelease.labels.start}</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><ExternalLink size={12} strokeWidth={1.75} />Open uier</span>
                <span className="flex items-center gap-1.5"><LogOut size={12} strokeWidth={1.75} />{extensionRelease.labels.signOut}</span>
            </div>
        </div>
    );
}

/** The thread pinned to the selected words */
function Thread() {
    return (
        <div className={cx('flex w-56 flex-col gap-2 rounded-xl border bg-popover p-3.5 text-popover-foreground', floating)}>
            <div className="flex items-center gap-2">
                <Avatar initials="LE" />
                <span className="text-[13px] font-medium">Leo</span>
                <span className="font-mono text-[11px] text-muted-foreground">now</span>
            </div>
            <span className="text-[13px] leading-5">We bake the bread daily too. Can we say so here?</span>
        </div>
    );
}

/** The two steps side by side: start a review from the popup, then comment with the toolbar */
export function ExtensionSpecimens() {
    const figures = [
        {
            caption: <>Open the extension on your site, choose the project and <strong className="font-medium text-foreground">{extensionRelease.labels.start}</strong>.</>,
            picture: (
                <BrowserFrame active>
                    <SitePage />
                    <div className="absolute right-3 top-3"><Popup /></div>
                </BrowserFrame>
            )
        },
        {
            caption: 'The review toolbar opens on the page. Pin comments to elements, text or areas.',
            picture: (
                <BrowserFrame>
                    <SitePage pinned />
                    <div className="absolute right-4 top-[150px] hidden sm:block"><Thread /></div>
                    <div className="absolute inset-x-0 bottom-5 flex justify-center"><ToolbarIllustration size="sm" /></div>
                </BrowserFrame>
            )
        }
    ];
    return (
        <div className="grid grid-cols-1 gap-8 pt-12 md:grid-cols-2 md:gap-6 md:pt-16">
            {figures.map((figure, index) => (
                <figure key={index} className="flex min-w-0 flex-col gap-3">
                    <div aria-hidden="true">{figure.picture}</div>
                    <figcaption className="text-sm leading-relaxed text-muted-foreground">{figure.caption}</figcaption>
                </figure>
            ))}
        </div>
    );
}
