'use client';

import { useContext, useRef, useState, type ReactNode, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Row } from '@signalco/ui-primitives/Row';
import { ArrowDownToLine, ArrowUp, Check, Delete, Edit, ExternalLink, Mail, MoreHorizontal, Mute, MyLocation, Pin, PinOff, Undo, User, Verified, Volume2 } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { destructiveTextClassName, floatingShadowClassName } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import { commentPriority, priorities, type CommentPriority } from '../triage';
import { keepMovedFocus, toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';
import { useMessages } from '../i18n';
import { useInkContainer } from './InkScope';

/** The first message's own options: the first message is the thread, so they share its menu (uier #470) */
export type FirstMessageActions = {
    /** Edit, Reattach comment and Delete wait while the message is saving or being deleted */
    disabled?: boolean;
    onEdit?: () => void;
    /** Pick the thread's element or text again (a thread on its own page) */
    onReattach?: () => void;
    /** Deleting asks first, with `confirmText` (e.g. "Delete this comment and your 2 replies?") */
    delete?: { confirmText: string; onDelete: () => void };
};

export type ThreadMenuActions = {
    message?: FirstMessageActions;
    /** "Unassigned" / "Assigned to Ana": opens the people under the header */
    assign?: { label: string; onAssign: () => void };
    priority?: { value: CommentPriority | undefined; pending: boolean; onChange: (priority: CommentPriority) => void };
    /** Request verification (or a new check) opens the form in the thread */
    verify?: { label: string; onRequest: () => void };
    follow?: { following: boolean; pending: boolean; onToggle: () => void };
    mute?: { muted: boolean; pending: boolean; onToggle: () => void };
    archive?: { archived: boolean; pending: boolean; onToggle: () => void };
    markUnread?: { pending: boolean; onMarkUnread: () => void };
    /** The thread in the signed-in uier app (`/app/projects/<code>?comment=<id>`), opened in a new tab; members only */
    openInApp?: { href: string };
};

function MenuButton({ icon, buttonRef, onClick, disabled, label, href, className, children }: { icon?: ReactNode; buttonRef?: Ref<HTMLButtonElement>; onClick: () => void; disabled?: boolean; label?: string; href?: string; className?: string; children: ReactNode }) {
    return (
        <Button ref={buttonRef} variant="plain" size="sm" fullWidth className={cx('justify-start', className)}
            startDecorator={icon && <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>}
            aria-label={label} disabled={disabled} onClick={onClick}
            // A link opens in a new tab, like Options → View project
            {...href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {}}>
            {children}
        </Button>
    );
}

/**
 * Thread options, the last of the header's actions: the first message's Edit and Reattach comment, the
 * triage and email controls, then Delete, so an opened thread shows its messages and reply box first and
 * its top has one menu (uier #470). Each item is there only for those who may use it (the API's
 * permissions); with none, there is no menu. Delete asks first, in the menu. A popover inside the
 * toolbar's shadow root, like `CommentThreadItemMenu` (a reply's More options); in the inbox it opens in
 * the ink scope, so it stays dark like the thread it belongs to.
 */
export function CommentThreadMenu({ className, actions, triggerRef }: { className?: string; actions: ThreadMenuActions; triggerRef?: Ref<HTMLButtonElement> }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const inkContainer = useInkContainer();
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const [choosingPriority, setChoosingPriority] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const firstRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    // Edit opens the editor in the thread, which takes the focus: the menu must not give it back to its button
    const leaveFocus = useRef(false);
    const { triggerProps, tooltip } = useIconTooltip(t.thread.options);
    const { message, assign, priority, verify, follow, mute, markUnread, archive, openInApp } = actions;
    const edit = message?.onEdit, reattach = message?.onReattach, remove = message?.delete;
    if (!edit && !reattach && !remove && !assign && !priority && !verify && !follow && !mute && !markUnread && !archive && !openInApp) return null;
    const close = () => { setOpen(false); setChoosingPriority(false); setConfirming(false); };
    const run = (action: () => void) => { close(); action(); };
    const current = commentPriority(priority?.value);

    // Radix props passed through the Popper to the popover content
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            firstRef.current?.focus();
        },
        onCloseAutoFocus: (event: Event) => {
            if (!leaveFocus.current) {
                keepMovedFocus(event);
                return;
            }
            leaveFocus.current = false;
            event.preventDefault();
        }
    };
    let first = true;
    const takeFirst = () => { const ref = first ? firstRef : undefined; first = false; return ref; };

    return <>
        <Popper
            container={inkContainer ?? rootElement}
            open={open}
            onOpenChange={next => { if (next) setOpen(true); else close(); }}
            align="end"
            aria-label={t.thread.options}
            // Like a menu: ↑ and ↓ move between its buttons
            onKeyDown={moveFocusInMenu}
            {...toolbarSurface('uier-thread-menu', cx('z-[70] w-60 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <IconButton
                    ref={triggerRef}
                    size="xs"
                    variant="plain"
                    className={className}
                    aria-label={t.thread.options}
                    data-uier-thread-control=""
                    {...triggerProps}>
                    <MoreHorizontal size={16} />
                </IconButton>
            )}
            {...contentProps}>
            {confirming && remove ? (
                <Stack spacing={1} className="p-2">
                    <p className="m-0 text-sm text-foreground">{remove.confirmText}</p>
                    <Row spacing={1} justifyContent="end">
                        <Button variant="plain" size="sm" onClick={close}>{t.common.cancel}</Button>
                        <Button ref={confirmRef} variant="outlined" size="sm" className={destructiveTextClassName} onClick={() => run(remove.onDelete)}>
                            {t.common.delete}
                        </Button>
                    </Row>
                </Stack>
            ) : <Stack>
                {edit && (
                    <MenuButton buttonRef={takeFirst()} icon={<Edit size={16} />} disabled={message?.disabled} onClick={() => { leaveFocus.current = true; run(edit); }}>{t.common.edit}</MenuButton>
                )}
                {reattach && (
                    <MenuButton buttonRef={takeFirst()} icon={<MyLocation size={16} />} disabled={message?.disabled} onClick={() => run(reattach)}>{t.thread.reattach}</MenuButton>
                )}
                {assign && (
                    // The visible words are part of the name: "Assigned to you. Change assignee"
                    <MenuButton buttonRef={takeFirst()} icon={<User size={16} />} label={t.thread.changeAssignee(assign.label)} onClick={() => run(assign.onAssign)}>
                        <span className="flex w-full items-baseline justify-between gap-2">
                            <span>{assign.label}</span>{' '}
                            <span className="text-xs font-normal text-muted-foreground">{t.thread.change}</span>
                        </span>
                    </MenuButton>
                )}
                {priority && <>
                    <MenuButton buttonRef={takeFirst()} icon={<ArrowUp size={16} />} label={t.thread.priorityChange(t.priority[current])} disabled={priority.pending}
                        onClick={() => setChoosingPriority(!choosingPriority)}>
                        {t.thread.priorityValue(t.priority[current])}
                    </MenuButton>
                    {choosingPriority && (
                        <div role="group" aria-label={t.thread.setPriority} className="flex flex-col pl-6">
                            {priorities.map(value => (
                                <Button key={value} variant="plain" size="sm" fullWidth className="justify-start" aria-pressed={value === current}
                                    disabled={priority.pending} endDecorator={value === current ? <Check size={14} /> : undefined}
                                    onClick={() => run(() => priority.onChange(value))}>
                                    {t.priority[value]}
                                </Button>
                            ))}
                        </div>
                    )}
                </>}
                {verify && (
                    <MenuButton buttonRef={takeFirst()} icon={<Verified size={16} />} onClick={() => run(verify.onRequest)}>{verify.label}</MenuButton>
                )}
                {follow && (
                    <MenuButton buttonRef={takeFirst()} icon={follow.following ? <PinOff size={16} /> : <Pin size={16} />} disabled={follow.pending} onClick={() => run(follow.onToggle)}>
                        {follow.following ? t.thread.unfollow : t.thread.follow}
                    </MenuButton>
                )}
                {mute && (
                    <MenuButton buttonRef={takeFirst()} icon={mute.muted ? <Volume2 size={16} /> : <Mute size={16} />} disabled={mute.pending} onClick={() => run(mute.onToggle)}>
                        {mute.muted ? t.thread.unmute : t.thread.mute}
                    </MenuButton>
                )}
                {archive && (
                    <MenuButton buttonRef={takeFirst()} icon={archive.archived ? <Undo size={16} /> : <ArrowDownToLine size={16} />} disabled={archive.pending} onClick={() => run(archive.onToggle)}>
                        {archive.archived ? t.thread.restore : t.thread.archive}
                    </MenuButton>
                )}
                {markUnread && (
                    <MenuButton buttonRef={takeFirst()} icon={<Mail size={16} />} disabled={markUnread.pending} onClick={() => run(markUnread.onMarkUnread)}>
                        {t.thread.markUnread}
                    </MenuButton>
                )}
                {openInApp && (
                    <MenuButton buttonRef={takeFirst()} icon={<ExternalLink size={16} />} href={openInApp.href} onClick={() => run(() => undefined)}>
                        {t.thread.openInApp}
                    </MenuButton>
                )}
                {remove && (
                    <MenuButton buttonRef={takeFirst()} icon={<Delete size={16} />} disabled={message?.disabled} className={destructiveTextClassName}
                        // After the question renders
                        onClick={() => { setConfirming(true); window.setTimeout(() => confirmRef.current?.focus(), 0); }}>
                        {t.thread.deleteMenu}
                    </MenuButton>
                )}
            </Stack>}
        </Popper>
        {tooltip}
    </>;
}
