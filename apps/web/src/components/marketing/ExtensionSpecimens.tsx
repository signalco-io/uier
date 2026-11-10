import type { ReactNode } from 'react';
import { Check, Down, Drag, ExternalLink, Globe, Inbox, LogOut, Megaphone, MoreHorizontal } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Logo } from '@uier/brand/Logo';
import { Mark } from '@uier/brand/Mark';
import { Pin } from '@uier/brand/Pin';
import { PIN_PATH, PIN_VIEWBOX } from '@uier/brand';
import { extensionRelease } from '../../lib/extension/release';
import { Avatar, floating } from './LandingSpecimens';

// Static pictures of the browser extension for /browser-extension: its popup (packages/extension/src/popup.tsx,
// the "Review this site" state with two matching projects) and the review toolbar it starts
// (packages/toolbar CommentToolbar, expanded). Built from the tokens like the landing specimens, never
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

/** Accessibility and SEO, drawn like the toolbar's own icons (checks/ChecksIcons.tsx) */
function CheckIcon({ kind }: { kind: 'accessibility' | 'seo' }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            {kind === 'accessibility'
                ? <><circle cx="12" cy="4.5" r="1.5" /><path d="M5 8.5 12 10l7-1.5" /><path d="M12 10v4.5" /><path d="m8.5 20.5 3.5-6 3.5 6" /></>
                : <><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="11.5" cy="11.5" r="3.5" /><path d="m16.5 16.5-2.5-2.5" /></>}
        </svg>
    );
}

/** The expanded review toolbar, ink like the rest of the review layer. Narrow, the checks move into its menu, as in the toolbar. */
function Toolbar() {
    const button = 'inline-flex size-8 shrink-0 items-center justify-center rounded-full';
    return (
        <div className="dark inline-flex items-center rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
            <span className={cx(button, 'text-muted-foreground')}><Drag size={18} style={{ strokeWidth: 1.25 }} /></span>
            <span className={button}>
                {/* Add comment: the outlined pin with a plus (CommentIcon) */}
                <svg viewBox={PIN_VIEWBOX} width="20" height="20" fill="none"><path d={PIN_PATH} stroke="currentColor" strokeWidth="1.75" /><path d="M9 16h14M16 9v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className={button}><Megaphone size={18} /></span>
            <span className={cx(button, 'relative')}>
                <Inbox size={18} />
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1 text-[10px] font-semibold tabular-nums text-[hsl(var(--brand-accent-foreground))]">2</span>
            </span>
            <span className={cx(button, 'hidden sm:inline-flex')}><CheckIcon kind="accessibility" /></span>
            <span className={cx(button, 'hidden sm:inline-flex')}><CheckIcon kind="seo" /></span>
            <span className="mx-1 h-5 w-px bg-border" />
            <span className={button}><span className="inline-flex size-6 items-center justify-center rounded-full border bg-accent text-[10px] font-semibold">LE</span></span>
            <span className={button}><MoreHorizontal size={18} /></span>
            <span className={button}><Down size={18} /></span>
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
                    <div className="absolute inset-x-0 bottom-5 flex justify-center"><Toolbar /></div>
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
