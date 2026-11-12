import type { ReactNode } from 'react';
import { ArrowRightIcon, CameraIcon, CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, FileCodeIcon, GlobeIcon, LogOutIcon, MaximizeIcon, PaperclipIcon, PlusIcon, PuzzleIcon, RotateCcwIcon, SendIcon } from 'lucide-react';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { Logo } from '@uier/brand/Logo';
import { Mark } from '@uier/brand/Mark';
import { Pin } from '@uier/brand/Pin';
import { embedScript } from '../../../lib/app/integration';
import { extensionRelease } from '../../../lib/extension/release';
import { AccessIcon, projectAccessLabels } from '../../app/projects/projectLabels';
import { ToolbarIllustration } from '../../brand/ToolbarIllustration';
import { Avatar, floating, StatusBadge, type Stage } from '../LandingSpecimens';

// Static pictures for the guides (docs/guides.md). Like the landing's specimens they are built from
// the tokens, never screenshots, and hidden from assistive technologies: the step beside each says
// the same. The example content is the landing's imaginary restaurant site. Each copies the shipped
// control it shows, so recheck it when that changes:
// - the app: Site addresses (ProjectSettingsForms), the install guide's tabs and Copy the script
//   (InstallGuide), Who can comment (projectLabels), a review link (GuestReviewLinks) and Check
//   installation (InstallationCheck);
// - the toolbar: the pill (ToolbarIllustration), New comment with its screenshot toggle
//   (CommentBubble, ComposerAttachmentsHeader);
// - the extension's popup (packages/extension/src/popup.tsx) in its signed-out, "Review this site"
//   and reviewing states.

const site = 'staging.example.com';
/** A project's public id as the script and review links carry it (a nanoid); only an example */
const exampleProjectCode = 'k7Qm2xV9pLr4TnW8cZb1a';
const icon = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** A small browser window: the address, an optional button beside it, then the page */
export function MiniBrowser({ address = site, toolbarEnd, children, className }: { address?: string; toolbarEnd?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cx('flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-card', floating, className)}>
            <div className="flex items-center gap-1.5 border-b px-3 py-2">
                <span className="size-2 shrink-0 rounded-full bg-muted" />
                <span className="size-2 shrink-0 rounded-full bg-muted" />
                <span className="size-2 shrink-0 rounded-full bg-muted" />
                <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">{address}</span>
                {toolbarEnd}
            </div>
            <div className="relative flex-1 bg-background p-4">{children}</div>
        </div>
    );
}

/** The example site's page, with a pinned comment on its headline when `pinned` */
function SitePage({ pinned, compact }: { pinned?: boolean; compact?: boolean }) {
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between gap-4 text-xs">
                <span className="font-semibold">Trattoria</span>
                <span className="flex gap-3 text-muted-foreground"><span>Menu</span><span>Visit</span><span>Book</span></span>
            </div>
            <span className={cx('font-semibold leading-tight tracking-[-0.03em]', compact ? 'mt-5 text-lg' : 'mt-8 text-[22px]')}>
                Fresh pasta,{' '}
                <span className={cx('relative', pinned && 'rounded-[3px] bg-[hsl(var(--brand-selection))]')}>
                    every day.
                    {pinned && <Pin number={3} size={22} className="absolute left-full top-full -ml-1 -mt-2" />}
                </span>
            </span>
            <span className="mt-2 text-xs text-muted-foreground">Lunch from noon, dinner until late.</span>
            <span className="mt-4 inline-flex h-7 items-center self-start rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Book a table</span>
        </div>
    );
}

/** A small card of the app, with its heading */
function AppCard({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
    return (
        <div className={cx('flex w-full flex-col gap-3 rounded-xl border bg-background p-3.5 text-[13px]', className)}>
            {title && <span className="text-[13px] font-semibold">{title}</span>}
            {children}
        </div>
    );
}

// The client review guide

/** The project's site addresses: the main site first, each with its label, then Add address */
export function SiteAddressesSpecimen() {
    const rows = [['example.com', 'Production'], [site, 'Staging']];
    return (
        <AppCard title="Site addresses" className="max-w-[300px]">
            <div className="flex flex-col gap-1.5">
                {rows.map(([address, label]) => (
                    <span key={address} className="flex items-center gap-2">
                        <span className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border px-2.5 font-mono text-xs">{address}</span>
                        <span className="flex h-8 w-[84px] shrink-0 items-center rounded-md border px-2.5 text-xs">{label}</span>
                    </span>
                ))}
            </div>
            <span className="inline-flex h-7 items-center gap-1.5 self-start rounded-md border px-2.5 text-xs font-medium"><PlusIcon {...icon} />Add address</span>
        </AppCard>
    );
}

/** The install guide's two tabs, with the script to copy */
export function InstallMethodSpecimen() {
    return (
        <AppCard className="max-w-[320px]">
            <span className="inline-flex gap-0.5 self-start rounded-lg bg-muted p-[3px] text-xs font-medium">
                <span className="inline-flex h-6 items-center whitespace-nowrap rounded-md bg-background px-2 shadow-sm">Install the script</span>
                <span className="inline-flex h-6 items-center whitespace-nowrap px-2 text-muted-foreground">Use browser extension</span>
            </span>
            <span className="flex items-start gap-2 rounded-md border bg-muted/50 p-2.5">
                <span className="line-clamp-3 min-w-0 flex-1 break-all font-mono text-[11px] leading-4">{embedScript(brand.url, exampleProjectCode)}</span>
                <CopyIcon {...icon} className="shrink-0 text-muted-foreground" />
            </span>
        </AppCard>
    );
}

/** Who can comment, in the project's review settings: invited people chosen, guests one choice away */
export function WhoCanCommentSpecimen() {
    return (
        <AppCard title="Who can comment" className="max-w-[320px]">
            <div className="flex flex-col gap-1.5">
                {(['invited', 'guests'] as const).map(access => (
                    <span key={access} className={cx('flex items-start gap-2.5 rounded-lg border p-2.5', access === 'invited' && 'border-foreground')}>
                        <AccessIcon access={access} {...icon} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-xs font-medium">{projectAccessLabels[access].label}</span>
                            <span className="line-clamp-1 text-[11px] text-muted-foreground">{projectAccessLabels[access].description}</span>
                        </span>
                        <span className={cx('mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border', access === 'invited' && 'border-foreground')}>
                            {access === 'invited' && <span className="size-1.5 rounded-full bg-foreground" />}
                        </span>
                    </span>
                ))}
            </div>
        </AppCard>
    );
}

/**
 * A review link (the site's address with the project's toolbar code, like the guest links and the
 * checked review link; TOOLBAR_CODE_PARAM in src/lib/app/projects.ts), and the site it opens with the toolbar
 */
export function ReviewLinkSpecimen() {
    return (
        <div className="flex w-full max-w-[760px] flex-col items-center gap-3 sm:flex-row">
            <AppCard className="max-w-[320px] gap-2">
                <span className="text-xs font-medium">Review link</span>
                <span className="flex items-start gap-2 rounded-md border bg-muted/50 p-2.5">
                    <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-4">https://{site}/?toolbar-code={exampleProjectCode}</span>
                    <CopyIcon {...icon} className="shrink-0 text-muted-foreground" />
                </span>
            </AppCard>
            <ArrowRightIcon {...icon} size={16} className="shrink-0 rotate-90 text-muted-foreground sm:rotate-0" />
            <MiniBrowser className="max-w-[380px]">
                <div className="flex flex-col">
                    <SitePage compact />
                    <div className="flex justify-center pt-5"><ToolbarIllustration size="sm" initials={null} unread={0} /></div>
                </div>
            </MiniBrowser>
        </div>
    );
}

/**
 * The statuses a thread goes through on its way to a confirmed fix (BRAND.md, "Status"), and Still
 * needs work, which sends it back to In progress
 */
export function StatusFlowSpecimen() {
    const stages: Stage[] = ['open', 'in-progress', 'ready', 'done'];
    return (
        <div className="flex w-full max-w-[640px] flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
                {stages.map((stage, index) => (
                    <span key={stage} className="flex items-center gap-2">
                        {index > 0 && <ArrowRightIcon {...icon} className="shrink-0 text-muted-foreground" />}
                        <span className="rounded-full bg-background"><StatusBadge stage={stage} /></span>
                    </span>
                ))}
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RotateCcwIcon {...icon} />
                Still needs work goes back to In progress
            </span>
        </div>
    );
}

/** For the guides index: a comment pinned on the example site, its thread open beside it */
export function ClientReviewThumbnail() {
    return (
        <div className="flex w-full max-w-[520px] items-center justify-center gap-4">
            <MiniBrowser className="max-w-[300px]">
                <SitePage pinned compact />
            </MiniBrowser>
            <div className={cx('hidden w-48 shrink-0 flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground sm:flex', floating)}>
                <span className="flex items-center gap-2">
                    <StatusBadge stage="ready" />
                    <span className="font-mono text-xs text-muted-foreground">#3</span>
                </span>
                <span className="flex items-center gap-2">
                    <Avatar initials="MI" small />
                    <span className="text-xs font-medium">Mia</span>
                </span>
                <span className="text-xs leading-4">Can this say we bake the bread daily too?</span>
            </div>
        </div>
    );
}

// The Next.js guide

/**
 * Copy the script, the first step of the project's install guide, with the project code in the
 * script tag marked
 */
export function ProjectCodeSpecimen() {
    const [before, after] = embedScript(brand.url, exampleProjectCode).split(exampleProjectCode);
    return (
        <div className="flex w-full max-w-[560px] gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium tabular-nums">1</span>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <span className="text-sm font-semibold">Copy the script</span>
                <div className="flex items-start gap-2 rounded-lg border bg-background p-3">
                    <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">
                        {before}
                        <span className="rounded-[3px] bg-muted px-0.5 font-semibold ring-1 ring-foreground">{exampleProjectCode}</span>
                        {after}
                    </span>
                    <CopyIcon {...icon} className="mt-0.5 shrink-0 text-muted-foreground" />
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="h-px w-4 bg-foreground" />
                    Your project code
                </span>
            </div>
        </div>
    );
}

/** The installation check after it confirmed the site, beside the site with a test comment and the toolbar */
export function InstallationCheckSpecimen() {
    return (
        <div className="grid w-full max-w-[860px] grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <AppCard title="Check installation" className="mx-auto max-w-[340px]">
                <span className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium">Site to check</span>
                    <span className="flex h-8 items-center justify-between gap-2 rounded-md border px-2.5 text-xs">
                        <span className="truncate">https://{site}</span>
                        <ChevronDownIcon {...icon} className="shrink-0 text-muted-foreground" />
                    </span>
                </span>
                <span className="inline-flex h-8 items-center self-start rounded-md border px-3 text-xs font-medium">Retry installation check</span>
                <span className="text-xs leading-5">Installation confirmed. The correct toolbar, review API and browser verification work on this page.</span>
                <span className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border px-3 text-xs font-medium">Open checked review</span>
            </AppCard>
            <MiniBrowser className="hidden md:flex">
                <div className="flex min-h-[220px] flex-col">
                    <SitePage pinned />
                    <div className="mt-auto flex justify-center pt-6"><ToolbarIllustration size="sm" /></div>
                </div>
            </MiniBrowser>
        </div>
    );
}

/** For the guides index: the root layout with the Script line marked */
export function NextJsThumbnail() {
    const lines: [string, boolean?][] = [
        ['<html lang="en">'],
        ['  <body>'],
        ['    {children}'],
        ['    <Script src="…/toolbar.js"', true],
        ['      data-uier-project="…" />', true],
        ['  </body>'],
        ['</html>']
    ];
    return (
        <div className={cx('flex w-full max-w-[340px] flex-col overflow-hidden rounded-xl border bg-background', floating)}>
            <span className="flex items-center gap-1.5 border-b px-3 py-2 font-mono text-[11px] text-muted-foreground">
                <FileCodeIcon {...icon} />app/layout.tsx
            </span>
            <span className="flex flex-col py-2 font-mono text-[11px] leading-5">
                {lines.map(([line, added], index) => (
                    <span key={index} className={cx('whitespace-pre border-l-2 px-3', added ? 'border-foreground bg-muted' : 'border-transparent')}>{line}</span>
                ))}
            </span>
        </div>
    );
}

// The browser extension guide

const { labels } = extensionRelease;

/** The extension's popup: the lockup, its body, then Open uier and Sign out (`footer`, shown once signed in) */
function Popup({ footer = true, children, className }: { footer?: boolean; children: ReactNode; className?: string }) {
    return (
        <div className={cx('flex w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border bg-popover text-left text-popover-foreground', floating, className)}>
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
                <Logo size={16} />
                <span className="text-[11px] text-muted-foreground">Browser extension</span>
            </div>
            <div className="flex flex-col gap-3 p-3.5">{children}</div>
            {footer && (
                <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5"><ExternalLinkIcon size={12} strokeWidth={1.75} />Open {brand.name}</span>
                    <span className="flex items-center gap-1.5"><LogOutIcon size={12} strokeWidth={1.75} />{labels.signOut}</span>
                </div>
            )}
        </div>
    );
}

function PopupHeading({ children }: { children: ReactNode }) {
    return <span className="text-sm font-semibold tracking-[-0.01em]">{children}</span>;
}

function PopupSite() {
    return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
            <GlobeIcon {...icon} className="shrink-0" />
            <span className="truncate font-mono text-xs">{site}</span>
        </span>
    );
}

function PopupButton({ children, outlined }: { children: ReactNode; outlined?: boolean }) {
    return (
        <span className={cx('inline-flex h-8 items-center justify-center rounded-md text-[13px] font-medium', outlined ? 'border' : 'bg-primary text-primary-foreground')}>
            {children}
        </span>
    );
}

/** The browser's toolbar with the extensions menu and uier pinned beside it, then the signed-out popup */
export function ExtensionSignInSpecimen() {
    return (
        <div className="flex w-full max-w-[420px] flex-col">
            <div className={cx('flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2', floating)}>
                <span className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">{site}/menu</span>
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"><PuzzleIcon {...icon} size={16} /></span>
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-foreground"><Mark size={14} /></span>
            </div>
            <div className="flex items-start justify-end gap-3 pr-1 pt-2">
                <span className="mt-2 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    or press <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">{extensionRelease.shortcut}</kbd>
                </span>
                <Popup footer={false}>
                    <span className="flex flex-col gap-1">
                        <PopupHeading>Sign in to review sites</PopupHeading>
                        <span className="text-xs text-muted-foreground">{brand.shortDescription}</span>
                    </span>
                    <PopupButton>{labels.signIn}</PopupButton>
                    <span className="text-[11px] text-muted-foreground">For members of {brand.name} projects, including invited reviewers.</span>
                </Popup>
            </div>
        </div>
    );
}

/** A review from the popup: choose the project and start, review on the page, then exit */
export function ExtensionReviewSpecimen() {
    const arrow = <ArrowRightIcon {...icon} size={16} className="shrink-0 text-muted-foreground" />;
    return (
        <div className="flex w-full max-w-[1000px] items-center justify-center gap-4">
            <Popup>
                <span className="flex flex-col gap-1"><PopupHeading>Review this site</PopupHeading><PopupSite /></span>
                <span className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Choose a project</span>
                    <span className="flex flex-col overflow-hidden rounded-lg border">
                        {['Trattoria website', 'Trattoria booking'].map((name, index) => (
                            <span key={name} className={cx('flex h-9 items-center justify-between gap-2 px-3 text-[13px]', index > 0 && 'border-t', index === 0 && 'bg-muted')}>
                                <span className="truncate">{name}</span>
                                {index === 0 && <CheckIcon {...icon} className="shrink-0" />}
                            </span>
                        ))}
                    </span>
                </span>
                <PopupButton>{labels.start}</PopupButton>
            </Popup>
            <span className="hidden lg:block">{arrow}</span>
            <MiniBrowser className="hidden max-w-[380px] lg:flex">
                <div className="flex min-h-[230px] flex-col">
                    <SitePage pinned />
                    <div className="mt-auto flex justify-center pt-6"><ToolbarIllustration size="sm" /></div>
                </div>
            </MiniBrowser>
            <span className="hidden md:block">{arrow}</span>
            <Popup className="hidden md:flex">
                <span className="flex flex-col gap-1"><PopupHeading>Review this site</PopupHeading><PopupSite /></span>
                <span className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]" />
                        <span className="truncate">Reviewing Trattoria website</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">The toolbar stays on this tab when you reload or open other pages of this site.</span>
                </span>
                <PopupButton outlined>{labels.exit}</PopupButton>
            </Popup>
        </div>
    );
}

/**
 * A new comment on the example site: the part of the page its screenshot shows, marked, and the
 * comment box with the screenshot toggle's tooltip
 */
export function ScreenshotSpecimen() {
    const hours = [['Monday to Friday', '12–23'], ['Saturday', '12–24'], ['Sunday', 'Closed']];
    const corner = 'absolute size-3 border-foreground';
    return (
        <div className="flex w-full max-w-[640px] items-center justify-center gap-8">
            <div className="hidden w-full max-w-[240px] flex-col sm:flex">
                <span className="text-lg font-semibold tracking-[-0.015em]">Opening hours</span>
                <div className="mt-3 flex flex-col text-sm">
                    {hours.map(([day, time]) => (
                        <span key={day} className="relative flex justify-between border-b py-1.5 tabular-nums">
                            <span>{day}</span>
                            <span className="text-muted-foreground">{time}</span>
                            {day === 'Sunday' && <>
                                {/* The part of the page the screenshot keeps */}
                                <span className={cx(corner, '-left-2 -top-1 border-l-2 border-t-2')} />
                                <span className={cx(corner, '-right-2 -top-1 border-r-2 border-t-2')} />
                                <span className={cx(corner, '-bottom-1 -left-2 border-b-2 border-l-2')} />
                                <span className={cx(corner, '-bottom-1 -right-2 border-b-2 border-r-2')} />
                                <Pin size={22} className="absolute left-[56%] top-[55%]" />
                            </>}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex w-full max-w-[280px] shrink-0 flex-col gap-2">
                {/* The screenshot toggle's tooltip */}
                <span className="self-end rounded-md bg-foreground px-2.5 py-1.5 text-[11px] leading-4 text-background">
                    A screenshot of this part of the page will be attached. Select to send only the text.
                </span>
                <div className={cx('flex flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground', floating)}>
                    <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">New comment</span>
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                            <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-foreground"><CameraIcon {...icon} size={16} /></span>
                            <span className="inline-flex size-7 items-center justify-center"><MaximizeIcon {...icon} /></span>
                        </span>
                    </span>
                    <span className="flex min-h-20 flex-col justify-between rounded-lg border p-2.5 text-[13px]">
                        <span>We open on Sundays since May.</span>
                        <span className="flex items-center justify-between text-muted-foreground">
                            <PaperclipIcon {...icon} />
                            <SendIcon {...icon} />
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}

/**
 * Where the toolbar comes from with the extension: its code ships inside the extension, and the
 * extension makes the requests to uier, so the page's own policy has nothing to allow
 */
export function ExtensionHeadersSpecimen() {
    const node = 'flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl border bg-background px-3 py-3 text-center sm:flex-1';
    const link = 'flex shrink-0 items-center justify-center gap-1.5 text-[11px] text-muted-foreground sm:flex-col sm:gap-1';
    return (
        <div className="flex w-full max-w-[640px] flex-col items-center gap-2 sm:flex-row sm:items-stretch">
            <span className={node}>
                <span className="text-[13px] font-semibold">The page</span>
                <span className="text-[11px] leading-4 text-muted-foreground">Its security headers stay as they are</span>
            </span>
            <span className={link}>
                <ArrowRightIcon {...icon} className="-rotate-90 sm:rotate-180" />
                <span>toolbar</span>
            </span>
            <span className={cx(node, 'border-foreground')}>
                <Mark size={16} />
                <span className="text-[13px] font-semibold">The extension</span>
                <span className="text-[11px] leading-4 text-muted-foreground">Toolbar code and screenshots</span>
            </span>
            <span className={link}>
                <ArrowRightIcon {...icon} className="rotate-90 sm:rotate-0" />
                <span>requests</span>
            </span>
            <span className={node}>
                <span className="font-mono text-[13px] font-semibold">{brand.domain}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">Comments and sign-in</span>
            </span>
        </div>
    );
}

/** For the guides index: the popup on the example site, ready to start a review */
export function ExtensionThumbnail() {
    return (
        <div className="flex w-full max-w-[340px] flex-col items-end">
            <div className={cx('flex w-full items-center gap-1.5 rounded-xl border bg-card px-3 py-2', floating)}>
                <span className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">{site}</span>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted"><Mark size={12} /></span>
            </div>
            <Popup footer={false} className="-mt-1 mr-1 w-[230px] scale-95">
                <span className="flex flex-col gap-1"><PopupHeading>Review this site</PopupHeading><PopupSite /></span>
                <PopupButton>{labels.start}</PopupButton>
            </Popup>
        </div>
    );
}
