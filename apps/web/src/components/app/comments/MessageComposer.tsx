'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SendIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/src/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/src/components/ui/input-group';
import { Spinner } from '@/src/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { useMentionTextarea, type MessageMention } from './MentionTextarea';

/**
 * Where a person writes a message in the app: a reply, or a message edited in place. One layout everywhere, as
 * the toolbar's composer: a box with the text and, inside it under the text, the mention hint or the character
 * count and the buttons (cancel, Discard, then send or Save); under the box, the mention list, the error and the
 * notices. What Enter, Shift+Enter and Escape do is said to screen readers only (the keyboard shortcuts dialog lists
 * them for everyone). The field takes the focus with the caret at the end when it opens.
 *
 * A surface switches features through its props: `mentionsIn` for `@` mentions, `onCancel` for its cancel button
 * (`escapeCancels` makes Escape press it), `onDiscard` for Discard. `submitVerb` "send" shows the send icon button
 * named `submitLabel`, "save" a text button.
 */
export function MessageComposer({ label, formLabel = label, name, placeholder, value, mentions, onValueChange, mentionsIn, maxLength = 1000, textareaRef,
    submitLabel, submitVerb, onSubmit, pending = false, cancelLabel = 'Cancel', onCancel, escapeCancels = false, onDiscard, error, announcement, notices }: {
    /** The field's name ("Reply", "Edit reply") */
    label: string;
    /** The form's name, when it differs from the field's ("Reply to thread") */
    formLabel?: string;
    name: string;
    placeholder?: string;
    value: string;
    mentions: MessageMention[];
    onValueChange: (value: string, mentions: MessageMention[]) => void;
    /** The thread whose people `@` can mention; no mentions without it */
    mentionsIn?: { projectId: string; commentId: string };
    maxLength?: number;
    textareaRef?: RefObject<HTMLTextAreaElement | null>;
    submitLabel: string;
    /** What Enter does, for the field's description: send new text (the send icon button) or save an edit (a text button) */
    submitVerb: 'send' | 'save';
    onSubmit: () => void;
    /** Sending or saving: the submit button shows a spinner and waits */
    pending?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
    /** Escape (once no mention list is open) presses the cancel button */
    escapeCancels?: boolean;
    /** Shown while there is text */
    onDiscard?: () => void;
    /** Why the last send or save failed */
    error?: ReactNode;
    /** Spoken to screen readers: sending, posted, discarded */
    announcement?: string;
    /** Under the field: storage and recovery notices */
    notices?: ReactNode;
}) {
    const ownRef = useRef<HTMLTextAreaElement>(null);
    const textarea = textareaRef ?? ownRef;
    const form = useRef<HTMLFormElement>(null);
    const [mentioned, setMentioned] = useState('');
    const inputId = useId();
    const hintId = useId();
    const keysId = useId();
    const escape = escapeCancels ? onCancel : undefined;
    const { textareaProps, list } = useMentionTextarea({
        mentionsIn, value, mentions, maxLength, textareaRef: textarea, onValueChange,
        onSubmit: () => form.current?.requestSubmit(), onEscape: escape, onMention: person => setMentioned(`Mentioned ${person}`)
    });
    const counting = value.length >= maxLength * 0.9;
    const canSubmit = Boolean(value.trim()) && !pending;

    useEffect(() => {
        const input = textarea.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    }, [textarea]);

    return <form ref={form} aria-label={formLabel} aria-busy={pending || undefined} onSubmit={event => {
        event.preventDefault();
        if (canSubmit) onSubmit();
    }}>
        <Field data-invalid={error ? true : undefined} className="gap-1.5">
            <FieldLabel htmlFor={inputId} className="sr-only">{label}</FieldLabel>
            {/* One box: the text, then its hint or counter and the buttons; the box shows the focus */}
            <InputGroup className="bg-background">
                <InputGroupTextarea {...textareaProps} id={inputId} name={name} rows={2} placeholder={placeholder}
                    enterKeyHint={submitVerb === 'send' ? 'send' : 'done'} autoComplete="off"
                    className="max-h-44 min-h-14 overflow-y-auto px-3 pt-2.5 pb-1"
                    aria-describedby={`${hintId} ${keysId}`} aria-invalid={error ? true : undefined} />
                <InputGroupAddon align="block-end" className="cursor-default justify-between gap-2 py-1.5 pr-1.5 pl-3 font-normal">
                    <span id={hintId} className={`min-w-0 truncate text-xs tabular-nums ${value.length >= maxLength ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {counting ? <>{value.length}/{maxLength}<span className="sr-only"> characters</span></>
                            : mentionsIn && <><span aria-hidden="true">@ to mention</span><span className="sr-only">Type @ to mention someone with access.</span></>}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                        {onCancel && <Button variant="ghost" size="xs" className="pointer-coarse:min-h-11" onClick={onCancel}>{cancelLabel}</Button>}
                        {onDiscard && value.length > 0 && <Button variant="ghost" size="xs" className="pointer-coarse:min-h-11" onClick={onDiscard}>Discard</Button>}
                        {submitVerb === 'send'
                            ? <Tooltip>
                                <TooltipTrigger render={<Button type="submit" variant="ghost" size="icon-xs" aria-label={submitLabel} disabled={!canSubmit}
                                    className="size-7 pointer-coarse:size-11" />}>
                                    {pending ? <Spinner /> : <SendIcon />}
                                </TooltipTrigger>
                                <TooltipContent>{submitLabel}</TooltipContent>
                            </Tooltip>
                            : <Button type="submit" variant="ghost" size="xs" className="pointer-coarse:min-h-11" disabled={!canSubmit}>
                                {pending && <Spinner data-icon="inline-start" />}{submitLabel}
                            </Button>}
                    </div>
                </InputGroupAddon>
            </InputGroup>
            {/* For screen readers only, out of the layout: Enter in a text box usually adds a line */}
            <FieldDescription id={keysId} className="sr-only">
                Enter to {submitVerb}. Shift+Enter for a new line.{escape && ' Escape to cancel.'}
            </FieldDescription>
            {list}
            {error && <FieldError role="alert">{error}</FieldError>}
            {notices}
        </Field>
        <p role="status" className="sr-only">{mentioned}</p>
        {announcement !== undefined && <p role="status" className="sr-only">{announcement}</p>}
    </form>;
}
