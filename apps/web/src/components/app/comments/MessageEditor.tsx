'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/src/components/ui/field';
import { MentionTextarea, type MessageMention } from './MentionTextarea';

const maxLength = 1000;

/**
 * A message edited in place, in the open thread: its saved text (mentions kept where they are) in a field
 * with Cancel and Save, as the toolbar edits a message. Enter saves, Shift+Enter adds a line, Escape cancels.
 */
export function MessageEditor({ projectId, commentId, label, text: initialText, mentions: initialMentions, error, onCancel, onSave }: {
    projectId: string;
    commentId: string;
    /** "Edit reply": the form's and the field's name */
    label: string;
    text: string;
    mentions: MessageMention[];
    /** Why the last save failed; the text is kept */
    error?: string;
    onCancel: () => void;
    onSave: (text: string, mentions: MessageMention[]) => void;
}) {
    const [text, setText] = useState(initialText);
    const [mentions, setMentions] = useState(initialMentions);
    const [announcement, setAnnouncement] = useState('');
    const textarea = useRef<HTMLTextAreaElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const inputId = useId();
    const hintId = useId();

    useEffect(() => {
        const input = textarea.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    }, []);

    return <form ref={form} aria-label={label} className="flex flex-col gap-2" onSubmit={event => {
        event.preventDefault();
        if (text.trim()) onSave(text, mentions);
    }}>
        <Field data-invalid={error ? true : undefined} className="gap-2">
            <FieldLabel htmlFor={inputId} className="sr-only">{label}</FieldLabel>
            <MentionTextarea projectId={projectId} commentId={commentId} value={text} mentions={mentions} maxLength={maxLength} textareaRef={textarea}
                onValueChange={(value, next) => { setText(value); setMentions(next); }} onSubmit={() => form.current?.requestSubmit()} onEscape={onCancel}
                onMention={name => setAnnouncement(`Mentioned ${name}`)}
                id={inputId} name="message" rows={2} className="max-h-44 resize-none overflow-y-auto" aria-describedby={hintId} aria-invalid={error ? true : undefined} />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldDescription id={hintId} className="m-0 text-xs">{text.length >= 900 ? `${text.length}/${maxLength} characters` : 'Enter to save · Esc to cancel'}</FieldDescription>
                <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={onCancel}>Cancel</Button>
                    <Button type="submit" variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={!text.trim()}>Save</Button>
                </div>
            </div>
            {error && <FieldError role="alert">{error}</FieldError>}
        </Field>
        <p role="status" className="sr-only">{announcement}</p>
    </form>;
}
