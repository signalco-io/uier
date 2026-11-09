'use client';

import { useEffect, useId, useState, type ComponentProps, type RefObject } from 'react';
import { mentionQuery, moveMentions } from '@uier/toolbar/mentions';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { Textarea } from '@/src/components/ui/textarea';
import { commentParticipantsAction } from './actions';

export type MessageMention = { userId: string; start: number; end: number };
type Participant = { id: string; name: string };

/**
 * A message's text field with `@` mentions, for a reply and for editing a message: typing `@` lists the
 * thread's eligible people (fetched on demand, `commentParticipantsAction`), the arrow keys move through them
 * and Enter or Tab inserts one. Mentions move with the text around them (`moveMentions`). Enter without Shift
 * submits; Escape closes the list first, then calls `onEscape`. Render it inside a `Field`.
 */
export function MentionTextarea({ projectId, commentId, value, mentions, maxLength, textareaRef, onValueChange, onSubmit, onEscape, onMention, ...props }: {
    projectId: string;
    commentId: string;
    value: string;
    mentions: MessageMention[];
    maxLength: number;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    onValueChange: (value: string, mentions: MessageMention[]) => void;
    onSubmit: () => void;
    onEscape?: () => void;
    /** A person was mentioned, for the form's announcement */
    onMention?: (name: string) => void;
} & Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onSelect' | 'onKeyDown' | 'maxLength' | 'ref'>) {
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const [people, setPeople] = useState<Participant[]>([]);
    const [peopleError, setPeopleError] = useState(false);
    const listId = useId();
    const query = dismissed ? undefined : mentionQuery(value, caret);
    const querying = Boolean(query);
    const suggestions = query ? people.filter(person => person.name.toLocaleLowerCase().includes(query.search)).slice(0, 8) : [];
    const selected = Math.min(active, Math.max(0, suggestions.length - 1));

    useEffect(() => {
        if (!querying) return;
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

    const selectMention = (person: Participant) => {
        if (!query) return;
        const label = `@${person.name}`;
        const next = value.slice(0, query.start) + label + ' ' + value.slice(query.end);
        if (next.length > maxLength) return;
        onValueChange(next, [...moveMentions(value, next, mentions), { userId: person.id, start: query.start, end: query.start + label.length }].sort((a, b) => a.start - b.start));
        setDismissed(true);
        const at = query.start + label.length + 1;
        requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(at, at); setCaret(at); });
        onMention?.(person.name);
    };

    return <>
        <Textarea {...props} ref={textareaRef} value={value} maxLength={maxLength}
            aria-autocomplete={suggestions.length ? 'list' : undefined} aria-controls={suggestions.length ? listId : undefined}
            aria-activedescendant={suggestions.length ? `${listId}-${selected}` : undefined}
            onSelect={event => setCaret(event.currentTarget.selectionStart)}
            onChange={event => {
                onValueChange(event.target.value, moveMentions(value, event.target.value, mentions));
                setCaret(event.target.selectionStart);
                setDismissed(false);
                setActive(0);
            }}
            onKeyDown={event => {
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
            }} />
        {suggestions.length > 0 && <div id={listId} role="listbox" aria-label="Mention people" className="max-h-48 overflow-y-auto rounded-xl border p-1">
            {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
                variant={index === selected ? 'secondary' : 'ghost'} size="sm" className="min-h-11 w-full justify-start"
                onMouseDown={event => event.preventDefault()} onClick={() => selectMention(person)}>
                <span className="truncate">{person.name}</span><span className="ml-auto font-mono text-xs">{person.id.slice(-6)}</span>
            </Button>)}
        </div>}
        {querying && peopleError && <FieldDescription role="status">People could not be loaded. You can still post without a mention.</FieldDescription>}
    </>;
}
