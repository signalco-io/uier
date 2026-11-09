'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/src/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { cn } from '@/src/lib/utils';
import { setCommentTitleAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

/** Longest title a member can give a thread, as `MANUAL_TITLE_MAX_LENGTH` (server-only module) */
const MAX_LENGTH = 120;

function AiMark() {
    return (
        <Tooltip>
            <TooltipTrigger render={<span role="img" aria-label="Title written by AI" className="mt-1 inline-flex shrink-0 text-muted-foreground" />}>
                <SparklesIcon aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Written by AI from the first message</TooltipContent>
        </Tooltip>
    );
}

/**
 * The open thread's title (`ProjectCommentView.title`), above its details: the one a member gave it, or
 * the one AI wrote with the AI mark. Those who can rename (`permissions.title`) click or focus it to edit
 * it in place: Enter or leaving the field saves, Escape cancels, and an empty title shows the AI title
 * again. Without a title, they get Add a title; others get no heading, as the first message shows below.
 * It pulls itself 8px up into the card's 16px gap, so it sits close under the status row.
 */
export function ThreadTitle({ projectId, commentId, title, byAi = false, canRename = false }: {
    projectId: string;
    commentId: string;
    title?: string;
    byAi?: boolean;
    canRename?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const input = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    // Focus given back after Enter or Escape must not open the field again
    const returning = useRef(false);
    const hintId = useId();

    useEffect(() => {
        if (!editing) return;
        input.current?.focus();
        input.current?.select();
    }, [editing]);

    if (!canRename) {
        if (!title) return null;
        return (
            <div className="-mt-4 flex min-w-0 items-start gap-1.5">
                <h2 className="m-0 min-w-0 text-base font-semibold break-words">{title}</h2>
                {byAi && <AiMark />}
            </div>
        );
    }

    const begin = () => {
        if (returning.current) { returning.current = false; return; }
        if (editing || pending) return;
        setDraft(title ?? '');
        setEditing(true);
    };
    const finish = (refocus: boolean) => {
        setEditing(false);
        if (refocus) {
            returning.current = true;
            // After the field is gone and the title is back
            requestAnimationFrame(() => { trigger.current?.focus(); returning.current = false; });
        }
    };
    const save = (refocus: boolean) => {
        const next = draft.replace(/\s+/gu, ' ').trim();
        finish(refocus);
        // Unchanged, or nothing to clear: an AI title stays the AI's
        if (next === (title ?? '') || (!next && byAi)) return;
        start(async () => {
            update({ id: commentId, patch: next ? { title: next, titleByAi: false } : { title: undefined, titleByAi: false } });
            try {
                const result = await setCommentTitleAction(projectId, commentId, next);
                if (!result?.ok) toast.error(result?.error ?? 'Could not rename the thread. Try again.');
            } catch { toast.error('Could not rename the thread. Try again.'); }
        });
    };

    if (editing) {
        return (
            <Input ref={input} value={draft} maxLength={MAX_LENGTH} aria-label="Thread title" placeholder="Add a title"
                className="-mx-1.5 -mt-4 h-auto w-[calc(100%+0.75rem)] px-1.5 py-0.5 text-base font-semibold md:text-base pointer-coarse:min-h-11"
                onChange={event => setDraft(event.target.value)}
                onBlur={() => save(false)}
                onKeyDown={event => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(true); }
                    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(true); }
                }} />
        );
    }

    const button = (
        <button ref={trigger} type="button" aria-describedby={hintId} aria-busy={pending || undefined}
            className={cn('-mx-1.5 min-w-0 cursor-text rounded-sm px-1.5 py-0.5 text-left break-words outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11',
                !title && 'text-sm font-normal text-muted-foreground')}
            onFocus={begin} onClick={begin}>
            {title || 'Add a title'}
        </button>
    );
    return (
        <div className="-mt-4 flex min-w-0 items-start gap-1.5">
            {title ? <h2 className="m-0 min-w-0 text-base font-semibold">{button}</h2> : button}
            {title && byAi && <AiMark />}
            <span id={hintId} hidden>{title ? 'Rename the thread' : 'Give the thread a title'}</span>
        </div>
    );
}
