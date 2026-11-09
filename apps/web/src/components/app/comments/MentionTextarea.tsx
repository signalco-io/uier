'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { mentionQuery, moveMentions } from '@uier/toolbar/mentions';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { commentParticipantsAction } from './actions';

export type MessageMention = { userId: string; start: number; end: number };
type Participant = { id: string; name: string };

/**
 * A message field's typing: `@` mentions, Enter and Escape, for `MessageComposer`. With `mentionsIn`, typing `@`
 * lists the thread's eligible people (fetched on demand, `commentParticipantsAction`), the arrow keys move through
 * them and Enter or Tab inserts one; without it the field is plain text. Mentions move with the text around them
 * (`moveMentions`). Enter without Shift submits; Escape closes the list first, then calls `onEscape`.
 * Spread `textareaProps` on the textarea and render `list` below the field.
 *
 * After a mention is inserted the caret goes right after it in the same commit as the new value (a layout
 * effect), before the next key is handled, so typing straight on never lands elsewhere. Any later input or
 * selection change drops a caret move still waiting for its value.
 */
export function useMentionTextarea({ mentionsIn, value, mentions, maxLength, textareaRef, onValueChange, onSubmit, onEscape, onMention }: {
    /** The thread whose people can be mentioned; mentions are off without it */
    mentionsIn?: { projectId: string; commentId: string };
    value: string;
    mentions: MessageMention[];
    maxLength: number;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    onValueChange: (value: string, mentions: MessageMention[]) => void;
    onSubmit: () => void;
    onEscape?: () => void;
    /** A person was mentioned, for the form's announcement */
    onMention?: (name: string) => void;
}) {
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const [people, setPeople] = useState<Participant[]>([]);
    const [peopleError, setPeopleError] = useState(false);
    const listId = useId();
    /** Where the caret goes once `value` is the text with the chosen mention */
    const pendingCaret = useRef<{ value: string; at: number } | null>(null);
    const query = dismissed || !mentionsIn ? undefined : mentionQuery(value, caret);
    const querying = Boolean(query);
    const suggestions = query ? people.filter(person => person.name.toLocaleLowerCase().includes(query.search)).slice(0, 8) : [];
    const selected = Math.min(active, Math.max(0, suggestions.length - 1));
    const projectId = mentionsIn?.projectId;
    const commentId = mentionsIn?.commentId;

    useEffect(() => {
        if (!querying || !projectId || !commentId) return;
        let current = true;
        setPeople([]);
        setPeopleError(false);
        commentParticipantsAction(projectId, commentId).then(result => {
            if (!current) return;
            if (result?.ok) setPeople(result.data);
            else setPeopleError(true);
        }).catch(() => { if (current) setPeopleError(true); });
        return () => { current = false; };
    }, [projectId, commentId, querying]);
    useLayoutEffect(() => {
        const pending = pendingCaret.current;
        const input = textareaRef.current;
        if (!pending || !input || value !== pending.value || input.value !== pending.value) return;
        pendingCaret.current = null;
        input.focus();
        input.setSelectionRange(pending.at, pending.at);
        setCaret(pending.at);
    }, [value, textareaRef]);

    const selectMention = (person: Participant) => {
        if (!query) return;
        const label = `@${person.name}`;
        const next = value.slice(0, query.start) + label + ' ' + value.slice(query.end);
        if (next.length > maxLength) return;
        pendingCaret.current = { value: next, at: query.start + label.length + 1 };
        onValueChange(next, [...moveMentions(value, next, mentions), { userId: person.id, start: query.start, end: query.start + label.length }].sort((a, b) => a.start - b.start));
        setDismissed(true);
        onMention?.(person.name);
    };

    const textareaProps = {
        ref: textareaRef,
        value,
        maxLength,
        'aria-autocomplete': suggestions.length ? 'list' as const : undefined,
        'aria-controls': suggestions.length ? listId : undefined,
        'aria-activedescendant': suggestions.length ? `${listId}-${selected}` : undefined,
        onSelect: (event: { currentTarget: HTMLTextAreaElement }) => { pendingCaret.current = null; setCaret(event.currentTarget.selectionStart); },
        onChange: (event: { target: HTMLTextAreaElement }) => {
            pendingCaret.current = null;
            onValueChange(event.target.value, moveMentions(value, event.target.value, mentions));
            setCaret(event.target.selectionStart);
            setDismissed(false);
            setActive(0);
        },
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.nativeEvent.isComposing) return;
            if (suggestions.length) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectMention(suggestions[selected]!); return; }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
            }
            if (event.key === 'Escape' && onEscape) { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); }
        }
    };

    const list: ReactNode = <>
        {suggestions.length > 0 && <div id={listId} role="listbox" aria-label="Mention people" className="max-h-48 overflow-y-auto rounded-xl border p-1">
            {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
                variant={index === selected ? 'secondary' : 'ghost'} size="sm" className="min-h-11 w-full justify-start"
                onMouseDown={event => event.preventDefault()} onClick={() => selectMention(person)}>
                <span className="truncate">{person.name}</span><span className="ml-auto font-mono text-xs">{person.id.slice(-6)}</span>
            </Button>)}
        </div>}
        {querying && peopleError && <FieldDescription role="status">People could not be loaded. You can still post without a mention.</FieldDescription>}
    </>;

    return { textareaProps, list };
}
