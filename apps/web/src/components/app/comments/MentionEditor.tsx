'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react';
import type { MarkdownEditorHandle, MentionQuery } from '@uier/toolbar/editor';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { commentParticipantsAction } from './actions';

export type MessageMention = { userId: string; start: number; end: number };
type Participant = { id: string; name: string };

/**
 * A message field's typing: `@` mentions, Enter and Escape, for `MessageComposer`'s editor (`@uier/toolbar/editor`).
 * With `mentionsIn`, typing `@` lists the thread's eligible people (fetched on demand, `commentParticipantsAction`),
 * the arrow keys move through them and Enter or Tab inserts one; without it there are no mentions. The editor keeps
 * each mention whole and moves it with the text. Enter without Shift submits; Escape closes the list first, then
 * calls `onEscape`. Pass `editorProps` to the editor, call `typed` on each change and render `list` below the field.
 *
 * The editor puts the mention and a space in place of the `@` being typed and the caret after them in the same
 * change, so typing straight on continues after the name.
 */
export function useMentionEditor({ mentionsIn, editorRef, onSubmit, onEscape, onMention }: {
    /** The thread whose people can be mentioned; mentions are off without it */
    mentionsIn?: { projectId: string; commentId: string };
    editorRef: RefObject<MarkdownEditorHandle | null>;
    onSubmit: () => void;
    onEscape?: () => void;
    /** A person was mentioned, for the form's announcement */
    onMention?: (name: string) => void;
}) {
    const { t } = useAppI18n();
    const [mentionQuery, setMentionQuery] = useState<MentionQuery>();
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const [people, setPeople] = useState<Participant[]>([]);
    const [peopleError, setPeopleError] = useState(false);
    const listId = useId();
    const query = dismissed || !mentionsIn ? undefined : mentionQuery;
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

    const selectMention = (person: Participant) => {
        // Not when it would make the text longer than its limit
        if (!query || !editorRef.current?.insertMention(person)) return;
        setDismissed(true);
        onMention?.(person.name);
    };

    const editorProps = {
        onMentionQuery: setMentionQuery,
        attributes: {
            'aria-autocomplete': suggestions.length ? 'list' : undefined,
            'aria-controls': suggestions.length ? listId : undefined,
            'aria-activedescendant': suggestions.length ? `${listId}-${selected}` : undefined
        },
        /** Keys before the editor's own: true when handled */
        onKeyDown: (event: KeyboardEvent) => {
            if (event.isComposing) return false;
            if (suggestions.length) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
                    return true;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { selectMention(suggestions[selected]!); return true; }
                if (event.key === 'Escape') { event.stopPropagation(); setDismissed(true); return true; }
            }
            if (event.key === 'Escape' && onEscape) { event.stopPropagation(); onEscape(); return true; }
            if (event.key === 'Enter' && !event.shiftKey) { onSubmit(); return true; }
            return false;
        }
    };

    /** The text changed: a list closed with Escape opens again for the next `@` */
    const typed = () => {
        setDismissed(false);
        setActive(0);
    };

    const list: ReactNode = <>
        {suggestions.length > 0 && <div id={listId} role="listbox" aria-label={t("Mention people")} className="max-h-48 overflow-y-auto rounded-xl border p-1">
            {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
                variant={index === selected ? 'secondary' : 'ghost'} size="sm" className="min-h-11 w-full justify-start"
                onMouseDown={event => event.preventDefault()} onClick={() => selectMention(person)}>
                <span className="truncate">{person.name}</span><span className="ml-auto font-mono text-xs">{person.id.slice(-6)}</span>
            </Button>)}
        </div>}
        {querying && peopleError && <FieldDescription role="status">{t("People could not be loaded. You can still post without a mention.")}</FieldDescription>}
    </>;

    return { editorProps, typed, list };
}
