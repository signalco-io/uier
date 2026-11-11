'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { SmilePlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { messageReactions, reactionEmoji, reactionIds, reactionNames, reactionPeople, type MessageReaction, type ReactionId } from '@uier/toolbar/reactions';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { Toggle } from '@/src/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { useCommentUpdate } from './CommentUpdates';
import { reactToCommentAction } from './actions';

// Emoji reactions to one message of the open thread (the first one or a reply), as in the toolbar's
// `MessageReactions`: Add reaction with the quick set in the message's header, the reactions under its text.
// A component of its own, so the message layout and its composers can change without touching it.

/** How long a touch or pen holds a reaction before it shows who reacted instead of toggling */
const holdMs = 500;

type MessageTarget = { projectId: string; commentId: string; itemId: string; reactions?: MessageReaction[] };

/** Adds or removes the member's own reaction: shown at once (`CommentUpdates`) until the action's fresh snapshot */
function useToggleReaction({ projectId, commentId, itemId, reactions }: MessageTarget) {
    const { t } = useAppI18n();
    const updateComment = useCommentUpdate();
    const [, startTransition] = useTransition();
    return (emoji: ReactionId) => {
        const reacted = !messageReactions(reactions).some(reaction => reaction.emoji === emoji && reaction.mine);
        startTransition(async () => {
            updateComment({ id: commentId, reaction: { itemId, emoji, reacted } });
            try {
                const result = await reactToCommentAction(projectId, commentId, itemId, emoji, reacted);
                if (result && !result.ok) toast.error(t(result.error));
            } catch {
                toast.error(t("Reaction not saved. Try again."));
            }
        });
    };
}

/** "You, Ana and 2 others reacted" in the app's language */
function useReactedText(reaction: MessageReaction) {
    const { t, language } = useAppI18n();
    const people = reactionPeople(reaction, t("You"), count => count === 1 ? t("1 other") : t("{count} others", { count }));
    return t("{people} reacted", { people: new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(people) });
}

/**
 * One reaction: the emoji and its count, pressed when one is the member's (a press adds or removes it). Its name
 * says the emoji and the count; who reacted is its description and its tooltip (hover, keyboard focus, or a long
 * press on a touch screen, which then does not toggle).
 */
function ReactionButton({ reaction, disabled, onToggle }: { reaction: MessageReaction; disabled: boolean; onToggle: () => void }) {
    const { t } = useAppI18n();
    const reacted = useReactedText(reaction);
    const descriptionId = useId();
    const triggerId = useId();
    const [open, setOpen] = useState(false);
    // `shown`: a long press opened the names; the press that ends it does not toggle (reset by the next press)
    const hold = useRef<{ timer?: number; shown: boolean }>({ shown: false });
    const cancelHold = () => window.clearTimeout(hold.current.timer);
    const name = t(reactionNames[reaction.emoji]);
    return (
        <>
            <Tooltip open={open} triggerId={triggerId} onOpenChange={(next, details) => {
                // Lifting the finger after a long press keeps the names it opened; a press elsewhere closes them
                if (!next && hold.current.shown && details.reason === 'trigger-press') return;
                setOpen(next);
            }}>
                <TooltipTrigger render={<Toggle id={triggerId} variant="outline" size="sm" pressed={reaction.mine} disabled={disabled} data-reaction={reaction.emoji}
                    aria-label={reaction.count === 1 ? t("{name}, 1 reaction", { name }) : t("{name}, {count} reactions", { name, count: reaction.count })}
                    aria-describedby={descriptionId}
                    // 32 px on a touch screen, its hit area 44 px (the state badge's pattern)
                    className={cn('relative h-6 min-w-0 touch-manipulation gap-1 rounded-full px-2 text-xs font-normal tabular-nums select-none [-webkit-touch-callout:none] after:absolute after:inset-x-0 after:-inset-y-1.5 pointer-fine:after:hidden pointer-coarse:h-8 pointer-coarse:px-3',
                        'text-muted-foreground aria-pressed:border-foreground/40 aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground')}
                    onPointerDown={event => {
                        hold.current.shown = false;
                        cancelHold();
                        if (event.pointerType === 'mouse') return;
                        hold.current.timer = window.setTimeout(() => { hold.current.shown = true; setOpen(true); }, holdMs);
                    }}
                    onPointerUp={cancelHold}
                    onPointerCancel={cancelHold}
                    onPointerLeave={cancelHold}
                    onKeyDown={() => { hold.current.shown = false; }}
                    onContextMenu={event => { if (hold.current.shown) event.preventDefault(); }}
                    onPressedChange={() => { if (!hold.current.shown) onToggle(); }} />}>
                    <span aria-hidden="true" className="text-sm leading-none">{reactionEmoji[reaction.emoji]}</span>
                    <span aria-hidden="true">{reaction.count}</span>
                </TooltipTrigger>
                <TooltipContent>{reacted}</TooltipContent>
            </Tooltip>
            <span id={descriptionId} hidden>{reacted}</span>
        </>
    );
}

/** The message's reactions, under its text; nothing while it has none */
export function ReactionList({ target, canReact }: { target: MessageTarget; canReact: boolean }) {
    const { t } = useAppI18n();
    const toggle = useToggleReaction(target);
    const reactions = messageReactions(target.reactions);
    if (!reactions.length) return null;
    return (
        <div role="group" aria-label={t("Reactions")} className="flex flex-wrap items-center gap-1 pt-0.5 pointer-coarse:gap-y-3" data-reactions>
            {reactions.map(reaction => <ReactionButton key={reaction.emoji} reaction={reaction} disabled={!canReact} onToggle={() => toggle(reaction.emoji)} />)}
        </div>
    );
}

/**
 * Add reaction (the smiley with a plus) and its popover of the quick set: toggle buttons named by what they show,
 * pressed for the member's own. The arrow keys move between them; a choice closes it and the focus goes back.
 */
export function ReactionPicker({ target, disabled }: { target: MessageTarget; disabled?: boolean }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const first = useRef<HTMLButtonElement>(null);
    const toggle = useToggleReaction(target);
    const mine = messageReactions(target.reactions).filter(reaction => reaction.mine).map(reaction => reaction.emoji);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={t("Add reaction")} data-add-reaction
                    className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11" />} />}>
                    <SmilePlusIcon />
                </TooltipTrigger>
                <TooltipContent>{t("Add reaction")}</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-auto gap-0 p-1" initialFocus={first} aria-label={t("Reactions")}>
                <ToggleGroup multiple spacing={0.5} value={mine} aria-label={t("Reactions")} onValueChange={next => {
                    const changed = reactionIds.find(emoji => next.includes(emoji) !== mine.includes(emoji));
                    setOpen(false);
                    if (changed) toggle(changed);
                }}>
                    {reactionIds.map((emoji, index) => (
                        <Tooltip key={emoji}>
                            <TooltipTrigger render={<ToggleGroupItem ref={index === 0 ? first : undefined} value={emoji} size="sm" aria-label={t(reactionNames[emoji])} data-reaction-choice={emoji}
                                className="size-8 min-w-8 p-0 text-base leading-none pointer-coarse:size-11" />}>
                                <span aria-hidden="true">{reactionEmoji[emoji]}</span>
                            </TooltipTrigger>
                            <TooltipContent>{t(reactionNames[emoji])}</TooltipContent>
                        </Tooltip>
                    ))}
                </ToggleGroup>
            </PopoverContent>
        </Popover>
    );
}
