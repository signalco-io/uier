'use client';

import { useContext, useRef, useState, type ReactNode, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, MoreHorizontal } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName } from './@types/Comments';
import { useIconTooltip } from './IconTooltip';
import { commentPriority, priorities, priorityLabels, type CommentPriority } from '../triage';
import { toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';

export type ThreadMenuActions = {
    /** "Unassigned" / "Assigned to Ana": opens the people under the header */
    assign?: { label: string; onAssign: () => void };
    priority?: { value: CommentPriority | undefined; pending: boolean; onChange: (priority: CommentPriority) => void };
    /** Mark as in progress, or Mark as open for a thread in progress (Done and Reopen are the header's button) */
    progress?: { label: string; pending: boolean; onChange: () => void };
    /** Request verification (or a new check) opens the form in the thread */
    verify?: { label: string; onRequest: () => void };
    follow?: { following: boolean; pending: boolean; onToggle: () => void };
    mute?: { muted: boolean; pending: boolean; onToggle: () => void };
    markUnread?: { pending: boolean; onMarkUnread: () => void };
};

function MenuButton({ icon, buttonRef, onClick, disabled, label, children }: { icon?: ReactNode; buttonRef?: Ref<HTMLButtonElement>; onClick: () => void; disabled?: boolean; label?: string; children: ReactNode }) {
    return (
        <Button ref={buttonRef} variant="plain" size="sm" fullWidth className="justify-start" startDecorator={icon}
            aria-label={label} disabled={disabled} onClick={onClick}>
            {children}
        </Button>
    );
}

/**
 * Thread options, the last of the header's actions: the triage and email controls, so an opened
 * thread shows its messages and reply box first. Each item is there only for those who may use it
 * (the API's permissions); with none, there is no menu. A popover inside the toolbar's shadow root,
 * like `CommentThreadItemMenu` (a message's More options).
 */
export function CommentThreadMenu({ className, actions, triggerRef }: { className?: string; actions: ThreadMenuActions; triggerRef?: Ref<HTMLButtonElement> }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const [choosingPriority, setChoosingPriority] = useState(false);
    const firstRef = useRef<HTMLButtonElement>(null);
    const { triggerProps, tooltip } = useIconTooltip('Thread options');
    const { assign, priority, progress, verify, follow, mute, markUnread } = actions;
    if (!assign && !priority && !progress && !verify && !follow && !mute && !markUnread) return null;
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
            container={rootElement}
            open={open}
            onOpenChange={next => { setOpen(next); if (!next) setChoosingPriority(false); }}
            align="end"
            aria-label="Thread options"
            // Like a menu: ↑ and ↓ move between its buttons
            onKeyDown={moveFocusInMenu}
            {...toolbarSurface('uier-thread-menu', cx('z-[70] w-60 max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <IconButton
                    ref={triggerRef}
                    size="xs"
                    variant="plain"
                    className={className}
                    aria-label="Thread options"
                    {...triggerProps}>
                    <MoreHorizontal size={16} />
                </IconButton>
            )}
            {...contentProps}>
            <Stack>
                {assign && (
                    // The visible words are part of the name: "Assigned to you. Change assignee"
                    <MenuButton buttonRef={takeFirst()} label={`${assign.label}. Change assignee`} onClick={() => run(assign.onAssign)}>
                        <span className="flex w-full items-baseline justify-between gap-2">
                            <span>{assign.label}</span>{' '}
                            <span className="text-xs font-normal text-muted-foreground">Change</span>
                        </span>
                    </MenuButton>
                )}
                {priority && <>
                    <MenuButton buttonRef={takeFirst()} label={`Priority: ${priorityLabels[current]}. Change priority`} disabled={priority.pending}
                        onClick={() => setChoosingPriority(!choosingPriority)}>
                        Priority: {priorityLabels[current]}
                    </MenuButton>
                    {choosingPriority && (
                        <div role="group" aria-label="Set priority" className="flex flex-col pl-6">
                            {priorities.map(value => (
                                <Button key={value} variant="plain" size="sm" fullWidth className="justify-start" aria-pressed={value === current}
                                    disabled={priority.pending} endDecorator={value === current ? <Check size={14} /> : undefined}
                                    onClick={() => run(() => priority.onChange(value))}>
                                    {priorityLabels[value]}
                                </Button>
                            ))}
                        </div>
                    )}
                </>}
                {progress && (
                    <MenuButton buttonRef={takeFirst()} disabled={progress.pending} onClick={() => run(progress.onChange)}>{progress.label}</MenuButton>
                )}
                {verify && (
                    <MenuButton buttonRef={takeFirst()} onClick={() => run(verify.onRequest)}>{verify.label}</MenuButton>
                )}
                {follow && (
                    <MenuButton buttonRef={takeFirst()} disabled={follow.pending} onClick={() => run(follow.onToggle)}>
                        {follow.following ? 'Unfollow thread' : 'Follow thread'}
                    </MenuButton>
                )}
                {mute && (
                    <MenuButton buttonRef={takeFirst()} disabled={mute.pending} onClick={() => run(mute.onToggle)}>
                        {mute.muted ? 'Unmute project emails' : 'Mute project emails'}
                    </MenuButton>
                )}
                {markUnread && (
                    <MenuButton buttonRef={takeFirst()} disabled={markUnread.pending} onClick={() => run(markUnread.onMarkUnread)}>
                        Mark as unread
                    </MenuButton>
                )}
            </Stack>
        </Popper>
        {tooltip}
    </>;
}
