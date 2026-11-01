'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { SendIcon } from 'lucide-react';
import { toast } from 'sonner';
import { createDraftStore } from '@uier/toolbar/drafts';
import { mentionQuery, moveMentions } from '@uier/toolbar/mentions';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import { commentParticipantsAction, replyCommentAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

const emptyMentions: { userId: string; start: number; end: number }[] = [];
const maxLength = 1000;
type Participant = { id: string; name: string };

/** Mounted only for the card whose Reply action was opened. */
export function ReplyComposer({ projectId, userId, comment, onClose }: {
    projectId: string; userId: string; comment: ProjectCommentView; onClose: () => void;
}) {
    const drafts = useMemo(() => createDraftStore([typeof location === 'undefined' ? '' : location.origin, 'app', projectId, userId, comment.id]), [projectId, userId, comment.id]);
    const key = 'reply';
    const text = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.get(key) ?? '', () => '');
    const mentions = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.details(key)?.mentions ?? emptyMentions, () => emptyMentions);
    const pending = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.pending(key), () => false);
    const recoveries = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.recoveries(key), () => 0);
    const [storageAvailable, setStorageAvailable] = useState(drafts.available);
    const [error, setError] = useState<string>();
    const [announcement, setAnnouncement] = useState('');
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const [people, setPeople] = useState<Participant[]>([]);
    const [peopleError, setPeopleError] = useState(false);
    const [, startTransition] = useTransition();
    const update = useCommentUpdate();
    const textarea = useRef<HTMLTextAreaElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const inputId = useId();
    const hintId = useId();
    const listId = useId();
    const query = dismissed ? undefined : mentionQuery(text, caret);
    const querying = Boolean(query);
    const suggestions = query ? people.filter(person => person.name.toLocaleLowerCase().includes(query.search)).slice(0, 8) : [];
    const selected = Math.min(active, Math.max(0, suggestions.length - 1));

    useEffect(() => {
        const input = textarea.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    }, []);
    useEffect(() => {
        if (!querying) return;
        let current = true;
        setPeople([]);
        setPeopleError(false);
        commentParticipantsAction(projectId, comment.id).then(result => {
            if (!current) return;
            if (result?.ok) setPeople(result.data);
            else setPeopleError(true);
        }).catch(() => { if (current) setPeopleError(true); });
        return () => { current = false; };
    }, [projectId, userId, comment.id, querying]);

    const setText = (value: string) => {
        drafts.set(key, value);
        drafts.setDetails(key, { mentions: moveMentions(text, value, mentions) });
        setStorageAvailable(drafts.available());
    };
    const selectMention = (person: Participant) => {
        if (!query) return;
        const label = `@${person.name}`;
        const value = text.slice(0, query.start) + label + ' ' + text.slice(query.end);
        if (value.length > maxLength) return;
        const nextMentions = [...moveMentions(text, value, mentions), { userId: person.id, start: query.start, end: query.start + label.length }].sort((a, b) => a.start - b.start);
        drafts.set(key, value);
        drafts.setDetails(key, { mentions: nextMentions });
        setStorageAvailable(drafts.available());
        setDismissed(true);
        const next = query.start + label.length + 1;
        requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next, next); setCaret(next); });
        setAnnouncement(`Mentioned ${person.name}`);
    };
    const submit = () => {
        const sentText = drafts.get(key) ?? '';
        if (!sentText.trim() || drafts.pending(key)) return;
        const sentMentions = drafts.details(key)?.mentions ?? [];
        const leading = sentText.length - sentText.trimStart().length;
        const selectedMentions = sentMentions.filter(mention => mention.end <= sentText.trimEnd().length)
            .map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }));
        const input = { projectId, commentId: comment.id, text: sentText.trim(), mentions: selectedMentions };
        const idempotencyKey = drafts.attempt(key, JSON.stringify(input));
        const sendId = drafts.startSend(key, sentText, sentMentions);
        setError(undefined);
        setAnnouncement('Sending reply...');
        startTransition(async () => {
            let saved = false;
            try {
                await drafts.run(key, async () => {
                    update({ id: comment.id, reply: { id: `pending-${sendId}`, author: { name: 'You', isMe: true }, text: input.text,
                        createdAt: new Date().toISOString(), deleted: false, edited: false, canDelete: false, canFilterAuthor: false, pending: true }, previousReplyIds: comment.replies.map(item => item.id) });
                    const result = await replyCommentAction({ ...input, idempotencyKey });
                    if (!result?.ok) throw new Error(result?.error ?? 'Could not post the reply. Try again.');
                });
                saved = true;
                setAnnouncement('Reply posted');
            } catch (failure) {
                const message = failure instanceof Error ? failure.message : 'Could not post the reply. Try again.';
                setError(message);
                toast.error('Your reply was not posted.', { description: `${message} Your draft is kept.` });
                setAnnouncement('Reply not posted. Your draft is kept.');
            } finally {
                drafts.settleSend(key, sendId, saved);
                setStorageAvailable(drafts.available());
            }
        });
    };

    return <form ref={form} onSubmit={event => { event.preventDefault(); submit(); }} aria-label="Reply to thread">
        <FieldGroup className="gap-2">
            <Field data-invalid={error ? true : undefined} className="gap-2">
                <FieldLabel htmlFor={inputId} className="sr-only">Reply</FieldLabel>
                <Textarea ref={textarea} id={inputId} name="reply" value={text} rows={2} maxLength={maxLength} placeholder="Reply..."
                    className="max-h-44 resize-none overflow-y-auto" aria-describedby={hintId} aria-invalid={error ? true : undefined}
                    aria-autocomplete={suggestions.length ? 'list' : undefined} aria-controls={suggestions.length ? listId : undefined}
                    aria-activedescendant={suggestions.length ? `${listId}-${selected}` : undefined}
                    onSelect={event => setCaret(event.currentTarget.selectionStart)}
                    onChange={event => { setText(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setActive(0); }}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (suggestions.length) {
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                event.preventDefault(); setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return;
                            }
                            if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectMention(suggestions[selected]!); return; }
                            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
                        }
                        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.current?.requestSubmit(); }
                    }} />
                {suggestions.length > 0 && <div id={listId} role="listbox" aria-label="Mention people" className="max-h-48 overflow-y-auto rounded-xl border p-1">
                    {suggestions.map((person, index) => <Button key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === selected}
                        variant={index === selected ? 'secondary' : 'ghost'} size="sm" className="min-h-11 w-full justify-start"
                        onMouseDown={event => event.preventDefault()} onClick={() => selectMention(person)}>
                        <span className="truncate">{person.name}</span><span className="ml-auto font-mono text-xs">{person.id.slice(-6)}</span>
                    </Button>)}
                </div>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldDescription id={hintId} className="m-0 text-xs">{text.length >= 900 ? `${text.length}/${maxLength} characters` : '@ to mention · Shift+Enter for a new line'}</FieldDescription>
                    <div className="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={onClose}>Close reply</Button>
                        {text.length > 0 && <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={() => { drafts.delete(key); setError(undefined); setAnnouncement('Draft discarded'); }}>Discard</Button>}
                        <Button type="submit" size="sm" className="pointer-coarse:min-h-11" disabled={!text.trim() || pending}>
                            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}Post reply
                        </Button>
                    </div>
                </div>
                {error && <FieldError role="alert">{error} Your draft is kept. Try sending again.</FieldError>}
                {querying && peopleError && <FieldDescription role="status">People could not be loaded. You can still post without a mention.</FieldDescription>}
                {!storageAvailable && <FieldDescription role="status">Browser storage is unavailable. Keep this page open to keep your draft.</FieldDescription>}
                {recoveries > 0 && <FieldDescription role="status">Earlier unsent text is kept separately because both drafts exceed the character limit.
                    <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => drafts.restore(key)}>Restore unsent text</Button></FieldDescription>}
            </Field>
        </FieldGroup>
        <p role="status" className="sr-only">{announcement}</p>
    </form>;
}
