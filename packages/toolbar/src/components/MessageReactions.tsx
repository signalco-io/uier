'use client';

import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { useMessages, useToolbarLanguage } from '../i18n';
import { messageReactions, reactionEmoji, reactionIds, reactionPeople, type MessageReaction, type ReactionId } from '../reactions';
import { useReaction } from '../hooks/useReactions';
import { rovingIndex } from '../keyboard';
import { toolbarSurface } from '../toolbarReview';
import { useIconTooltip } from './IconTooltip';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName, type CommentItem, type CommentItemThreadItem } from './@types/Comments';

// Emoji reactions to one message (the first one or a reply), the app's `MessageReactions` in the toolbar: the
// Add reaction button with the quick set beside the message's options, and the reactions under the message.
// Separate from the thread item, so composers and message layouts can change without touching it.

/** How long a touch or pen holds a reaction before it shows who reacted instead of toggling */
const holdMs = 500;

type ReactableItem = Exclude<CommentItemThreadItem, { deleted: true }>;

/** A saved message of a saved thread: one still on its way has no id the API knows */
export function canReact(comment: CommentItem, item: CommentItemThreadItem): item is ReactableItem {
    return !comment.pending && !item.deleted && !item.pending;
}

/** "You, Ana and 2 others reacted", in the toolbar's language */
function useReactedText(reaction: MessageReaction) {
    const t = useMessages();
    const language = useToolbarLanguage();
    const people = reactionPeople(reaction, t.reactions.you, t.reactions.others);
    return t.reactions.people(new Intl.ListFormat(language, { type: 'conjunction' }).format(people));
}

function useToggle(comment: CommentItem, item: ReactableItem) {
    const reaction = useReaction();
    return (emoji: ReactionId) => {
        const mine = messageReactions(item.reactions).some(existing => existing.emoji === emoji && existing.mine);
        reaction.mutate({ commentId: comment.id, itemId: item.id, emoji, reacted: !mine });
    };
}

/**
 * One reaction: the emoji and its count, pressed when one is the viewer's (a press adds or removes it). Its name
 * says the emoji and the count; who reacted is its description, and its tooltip on hover or keyboard focus, or
 * after a long press on a touch screen (which then does not toggle).
 */
function ReactionButton({ reaction, onToggle }: { reaction: MessageReaction; onToggle: () => void }) {
    const t = useMessages();
    const reacted = useReactedText(reaction);
    const descriptionId = useId();
    const tip = useIconTooltip(reacted, undefined, { prose: true });
    // `shown`: a long press opened the names; the press that ends it does not toggle (reset by the next press)
    const hold = useRef<{ timer?: number; shown: boolean }>({ shown: false });
    const [held, setHeld] = useState(false);
    const cancelHold = () => window.clearTimeout(hold.current.timer);
    // Names a long press opened stay after the finger lifts, until a press elsewhere or a scroll
    useEffect(() => {
        if (!held) return;
        const close = () => { setHeld(false); tip.close(); };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('scroll', close, true);
        return () => {
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('scroll', close, true);
        };
    }, [held, tip.close]);
    return (
        <>
            <button type="button" data-uier-reaction={reaction.emoji} aria-pressed={reaction.mine}
                aria-label={t.reactions.count(t.reactions.names[reaction.emoji], reaction.count)} aria-describedby={descriptionId}
                // 32 px on a touch screen, its hit area still 44 px (styles/toolbar-theme.css)
                className={cx('inline-flex h-6 shrink-0 cursor-pointer touch-manipulation select-none items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors duration-[120ms] [-webkit-touch-callout:none] pointer-coarse:h-8 pointer-coarse:px-3',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    reaction.mine ? 'border-foreground/40 bg-accent font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
                {...tip.triggerProps}
                onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
                    tip.triggerProps.onPointerDown(event);
                    hold.current.shown = false;
                    cancelHold();
                    if (event.pointerType === 'mouse') return;
                    const button = event.currentTarget;
                    hold.current.timer = window.setTimeout(() => { hold.current.shown = true; setHeld(true); tip.open(button); }, holdMs);
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                // A touch leaves as it lifts: only a mouse leaving hides the tooltip here
                onPointerLeave={(event: PointerEvent<HTMLButtonElement>) => { cancelHold(); if (event.pointerType === 'mouse') tip.triggerProps.onPointerLeave(); }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => { hold.current.shown = false; tip.triggerProps.onKeyDown(event); }}
                // A long press opens the system's menu on some phones; the names are the tooltip instead
                onContextMenu={event => { if (hold.current.shown) event.preventDefault(); }}
                onClick={() => { if (!hold.current.shown) onToggle(); }}>
                <span aria-hidden="true" className="text-sm leading-none">{reactionEmoji[reaction.emoji]}</span>
                <span aria-hidden="true">{reaction.count}</span>
            </button>
            <span id={descriptionId} hidden>{reacted}</span>
            {tip.tooltip}
        </>
    );
}

/** The message's reactions, under its text; nothing while it has none */
export function ReactionList({ comment, item }: { comment: CommentItem; item: CommentItemThreadItem }) {
    const t = useMessages();
    const reactable = canReact(comment, item);
    const toggle = useToggle(comment, item as ReactableItem);
    const reactions = item.deleted ? [] : messageReactions(item.reactions);
    if (!reactions.length) return null;
    return (
        <div role="group" aria-label={t.reactions.label} className="flex flex-wrap items-center gap-1 pointer-coarse:gap-y-3" data-uier-reactions="">
            {reactions.map(reaction => (
                <ReactionButton key={reaction.emoji} reaction={reaction} onToggle={() => { if (reactable) toggle(reaction.emoji); }} />
            ))}
        </div>
    );
}

/**
 * Add reaction (the smiley with a plus) and its popover of the quick set: each emoji a toggle button named by
 * what it shows, pressed when the viewer gave it. ← → (and ↑ ↓, Home, End) move between them; a choice closes
 * it and gives the focus back to Add reaction.
 */
export function ReactionPicker({ comment, item, disabled }: { comment: CommentItem; item: CommentItemThreadItem; disabled?: boolean }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const toggle = useToggle(comment, item as ReactableItem);
    const tip = useIconTooltip(t.reactions.add);
    const firstRef = useRef<HTMLButtonElement>(null);
    if (!canReact(comment, item)) return null;
    const reactions = messageReactions(item.reactions);
    // Radix props passed through the Popper to the popover content: the first emoji takes the focus
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            firstRef.current?.focus();
        }
    };
    const move = (event: KeyboardEvent<HTMLElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-uier-reaction-choice]')];
        const next = rovingIndex(event.key, buttons.indexOf(event.target as HTMLButtonElement), buttons.length, { orientation: 'both' });
        if (next === undefined) return;
        event.preventDefault();
        buttons[next]!.focus();
    };
    return (
        <>{tip.tooltip}<Popper
            container={rootElement}
            open={open}
            onOpenChange={setOpen}
            align="end"
            aria-label={t.reactions.label}
            onKeyDown={move}
            {...toolbarSurface('uier-reaction-picker', cx('z-[70] w-auto rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <IconButton size="xs" variant="plain" className="size-6 text-muted-foreground hover:text-foreground" {...tip.triggerProps}
                    aria-label={t.reactions.add} disabled={disabled} data-uier-add-reaction="" data-uier-thread-control="">
                    <SmilePlusIcon size={16} />
                </IconButton>
            )}
            {...contentProps}>
            <div className="flex items-center gap-0.5">
                {reactionIds.map((emoji, index) => {
                    const mine = reactions.some(reaction => reaction.emoji === emoji && reaction.mine);
                    return (
                        <ReactionChoice key={emoji} label={t.reactions.names[emoji]} pressed={mine} buttonRef={index === 0 ? firstRef : undefined}
                            emoji={emoji} onChoose={() => { setOpen(false); toggle(emoji); }} />
                    );
                })}
            </div>
        </Popper></>
    );
}

/** One emoji of the quick set, with its name as its tooltip */
function ReactionChoice({ emoji, label, pressed, buttonRef, onChoose }: { emoji: ReactionId; label: string; pressed: boolean; buttonRef?: Ref<HTMLButtonElement>; onChoose: () => void }) {
    const tip = useIconTooltip(label);
    return (
        <>
            <button ref={buttonRef} type="button" data-uier-reaction-choice={emoji} aria-pressed={pressed} aria-label={label} {...tip.triggerProps}
                className={cx('inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-base leading-none transition-colors duration-[120ms] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    pressed && 'bg-accent')}
                onClick={onChoose}>
                <span aria-hidden="true">{reactionEmoji[emoji]}</span>
            </button>
            {tip.tooltip}
        </>
    );
}

// "Add reaction": Lucide's smile-plus (ISC), drawn like the UI kit's icons (24 grid, 1.75 stroke, round caps)
function SmilePlusIcon({ size = 24 }: { size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 11v1a10 10 0 1 1-9-10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" x2="9.01" y1="9" y2="9" />
            <line x1="15" x2="15.01" y1="9" y2="9" />
            <path d="M16 5h6" />
            <path d="M19 2v6" />
        </svg>
    );
}
