'use client';

import { useContext, useRef, useState, type ReactNode, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { ArrowDownToLine, ArrowUp, Check, Mail, MoreHorizontal, Mute, Pin, PinOff, Undo, User, Verified, Volume2 } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import { commentPriority, priorities, type CommentPriority } from '../triage';
import { toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';
import { useMessages } from '../i18n';
import { useInkContainer } from './InkScope';

export type ThreadMenuActions = {
    /** "Unassigned" / "Assigned to Ana": opens the people under the header */
    assign?: { label: string; onAssign: () => void };
    priority?: { value: CommentPriority | undefined; pending: boolean; onChange: (priority: CommentPriority) => void };
    /** Request verification (or a new check) opens the form in the thread */
    verify?: { label: string; onRequest: () => void };
    follow?: { following: boolean; pending: boolean; onToggle: () => void };
    mute?: { muted: boolean; pending: boolean; onToggle: () => void };
    archive?: { archived: boolean; pending: boolean; onToggle: () => void };
    markUnread?: { pending: boolean; onMarkUnread: () => void };
};

function MenuButton({ icon, buttonRef, onClick, disabled, label, children }: { icon?: ReactNode; buttonRef?: Ref<HTMLButtonElement>; onClick: () => void; disabled?: boolean; label?: string; children: ReactNode }) {
    return (
        <Button ref={buttonRef} variant="plain" size="sm" fullWidth className="justify-start"
            startDecorator={icon && <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>}
            aria-label={label} disabled={disabled} onClick={onClick}>
            {children}
        </Button>
    );
}

/**
 * Thread options, the last of the header's actions: the triage and email controls, so an opened
 * thread shows its messages and reply box first. Each item is there only for those who may use it
 * (the API's permissions); with none, there is no menu. A popover inside the toolbar's shadow root,
 * like `CommentThreadItemMenu` (a message's More options); in the inbox it opens in the ink scope,
 * so it stays dark like the thread it belongs to.
 */
export function CommentThreadMenu({ className, actions, triggerRef }: { className?: string; actions: ThreadMenuActions; triggerRef?: Ref<HTMLButtonElement> }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const inkContainer = useInkContainer();
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const [choosingPriority, setChoosingPriority] = useState(false);
    const firstRef = useRef<HTMLButtonElement>(null);
    const { triggerProps, tooltip } = useIconTooltip(t.thread.options);
    const { assign, priority, verify, follow, mute, markUnread, archive } = actions;
    if (!assign && !priority && !verify && !follow && !mute && !markUnread && !archive) return null;
    const run = (action: () => void) => { setOpen(false); setChoosingPriority(false); action(); };
    const current = commentPriority(priority?.value);

    // Radix props passed through the Popper to the popover content
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            firstRef.current?.focus();
        }
    };
    let first = true;
    const takeFirst = () => { const ref = first ? firstRef : undefined; first = false; return ref; };

    return <>
        <Popper
            container={inkContainer ?? rootElement}
            open={open}
            onOpenChange={next => { setOpen(next); if (!next) setChoosingPriority(false); }}
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
            <Stack>
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
            </Stack>
        </Popper>
        {tooltip}
    </>;
}
