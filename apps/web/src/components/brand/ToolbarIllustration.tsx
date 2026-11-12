import { Down, Drag, Inbox, Megaphone, MoreHorizontal, UserCircle } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// A static picture of the review toolbar, expanded, in the order packages/toolbar CommentToolbar
// renders it: the move handle, Add comment, Send feedback, Inbox with its unread count, Page checks
// (Accessibility, SEO and Security and compliance behind one button), then the profile, Options and Collapse.
// Below 640 px the toolbar moves the page checks into Options, and so does the picture (the same breakpoint,
// `sm`). Ink like the rest of the review layer, from the dark tokens. Recheck it with CommentToolbar.

/** Page checks, drawn like the toolbar's own icon (packages/toolbar checks/ChecksIcons.tsx `PageChecksIcon`) */
export function PageChecksIcon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="m9 14.5 2 2 4-4" />
        </svg>
    );
}

/** Add comment: the outlined pin with a plus (packages/toolbar CommentIcon) */
export function AddCommentIcon({ size = 20 }: { size?: number }) {
    return (
        <svg viewBox={PIN_VIEWBOX} width={size} height={size} fill="none" aria-hidden="true">
            <path d={PIN_PATH} stroke="currentColor" strokeWidth="1.75" />
            <path d="M9 16h14M16 9v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function ToolbarIllustration({ size = 'md', unread = 2, initials = 'LE', attention = false }: {
    /** `md` at the toolbar's own size (the brand page), `sm` inside a scene */
    size?: 'sm' | 'md';
    unread?: number;
    /** The signed-in reviewer's initials on the profile button; `null` for a guest, whose button is a person icon (ToolbarProfile) */
    initials?: string | null;
    /** The Page checks button's amber dot: a check found something to act on */
    attention?: boolean;
}) {
    const small = size === 'sm';
    const button = cx('relative inline-flex shrink-0 items-center justify-center rounded-full', small ? 'size-8' : 'size-10');
    const icon = small ? 18 : 22;
    const dot = small ? 'right-1 top-1' : 'right-1.5 top-1.5';
    return (
        <div
            role="img"
            aria-label={`The review toolbar: move, add comment, send feedback, inbox with ${unread} unread, page checks, profile, options and collapse`}
            className="dark inline-flex w-max items-center rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
            <span className={cx(button, 'text-muted-foreground')}><Drag size={icon} style={{ strokeWidth: 1.25 }} /></span>
            <span className={button}><AddCommentIcon size={small ? 20 : 24} /></span>
            <span className={button}><Megaphone size={icon} /></span>
            <span className={button}>
                <Inbox size={icon} />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1 text-[10px] font-semibold tabular-nums text-[hsl(var(--brand-accent-foreground))]">{unread}</span>}
            </span>
            <span className={cx(button, 'hidden sm:inline-flex')}>
                <PageChecksIcon size={icon} />
                {attention && <span className={cx('absolute size-2 rounded-full bg-[hsl(var(--brand-warning))]', dot)} />}
            </span>
            <span className={cx('mx-1 w-px shrink-0 bg-border', small ? 'h-5' : 'h-6')} />
            <span className={button}>
                {initials
                    ? <span className={cx('inline-flex items-center justify-center rounded-full border bg-accent font-semibold', small ? 'size-6 text-[10px]' : 'size-7 text-[11px]')}>{initials}</span>
                    : <UserCircle size={icon} />}
            </span>
            <span className={button}><MoreHorizontal size={icon} /></span>
            <span className={button}><Down size={icon} /></span>
        </div>
    );
}
