'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { lazy, Suspense, useId, useRef, useState, type ReactNode, type RefObject, type ClipboardEventHandler } from 'react';
import { SendIcon, XIcon } from 'lucide-react';
import type { MarkdownEditorHandle } from '@uier/toolbar/editor';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError } from '@/src/components/ui/field';
import { InputGroup, InputGroupAddon } from '@/src/components/ui/input-group';
import { Spinner } from '@/src/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { useMentionEditor, type MessageMention } from './MentionEditor';

const loadEditor = () => import('@uier/toolbar/editor');
/** The rich editor (ProseMirror) is its own chunk: pages load it only once a message is written */
const MarkdownEditor = lazy(() => loadEditor().then(module => ({ default: module.MarkdownEditor })));
/** Loads the editor ahead of a reply box, while the page is idle (the open thread, `CommentCard`) */
export const preloadMessageEditor = () => { void loadEditor(); };

/**
 * Where a person writes a message in the app: a reply, or a message edited in place. One layout everywhere, as
 * the toolbar's composer: a box with the text and, inside it under the text, the character count (from 900 of 1000)
 * and the buttons (cancel, Discard, then send or Save); under the box, the mention list, the error and the
 * notices. The `@` mentions (uier #287) and what Enter, Shift+Enter and Escape do are said to screen readers only
 * (the keyboard shortcuts dialog lists the keys for everyone). The field takes the focus with the caret at the end when it opens.
 *
 * The field is the rich message editor shared with the toolbar (`@uier/toolbar/editor`): Markdown typed as you
 * write and Ctrl/⌘+B, I, E format the text, which is saved as Markdown (`value`, with the mentions' ranges).
 *
 * A surface switches features through its props: `mentionsIn` for `@` mentions, `onCancel` for its cancel button
 * (`escapeCancels` makes Escape press it), `onEscapeEmpty` for Escape in an empty field, `onDiscard` for Discard. `submitVerb` "send" shows the send icon button
 * named `submitLabel`, "save" a text button.
 */
export function MessageComposer({ label, formLabel = label, name, placeholder, value, mentions, onValueChange, mentionsIn, maxLength = 1000, fieldRef,
    submitLabel, submitVerb, onSubmit, pending = false, cancelLabel, onCancel, escapeCancels = false, onEscapeEmpty, onDiscard, error, announcement, notices, attachments, onPaste, onImageDrop, holdSubmit = false }: {
    attachments?: ReactNode;
    onPaste?: ClipboardEventHandler<HTMLFormElement>;
    /** An image file dropped on the text */
    onImageDrop?: (file: File) => void;
    holdSubmit?: boolean;
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
    /** The field, for a shortcut that focuses it (R) */
    fieldRef?: RefObject<{ focus: () => void } | null>;
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
    /** Escape (once no mention list is open) while the field is empty: closes a surface that has no cancel button */
    onEscapeEmpty?: () => void;
    /** Shown while there is text */
    onDiscard?: () => void;
    /** Why the last send or save failed */
    error?: ReactNode;
    /** Spoken to screen readers: sending, posted, discarded */
    announcement?: string;
    /** Under the field: storage and recovery notices */
    notices?: ReactNode;
}) {
    const { t } = useAppI18n();
    const editor = useRef<MarkdownEditorHandle | null>(null);
    const form = useRef<HTMLFormElement>(null);
    const [mentioned, setMentioned] = useState('');
    const inputId = useId();
    const hintId = useId();
    const keysId = useId();
    const escape = escapeCancels ? onCancel : !value ? onEscapeEmpty : undefined;
    const { editorProps, typed, list } = useMentionEditor({
        mentionsIn, editorRef: editor,
        onSubmit: () => form.current?.requestSubmit(), onEscape: escape, onMention: person => setMentioned(t("Mentioned {value0}", { value0: person }))
    });
    const counting = value.length >= maxLength * 0.9;
    const canSubmit = Boolean(value.trim()) && !pending && !holdSubmit;
    // The editor's own text box and the surface's shortcut share the handle
    const setEditor = (handle: MarkdownEditorHandle | null) => {
        editor.current = handle;
        if (fieldRef) fieldRef.current = handle;
    };

    return <form ref={form} onPaste={onPaste} aria-label={formLabel} aria-busy={pending || undefined} onSubmit={event => {
        event.preventDefault();
        if (canSubmit) onSubmit();
    }}>
        <Field data-invalid={error ? true : undefined} className="gap-1.5">
            {/* One box: the text, then its hint or counter and the buttons; the box shows the focus */}
            <InputGroup className="bg-background">
                <Suspense fallback={<div aria-hidden="true" className="min-h-14 w-full px-3 pt-2.5 pb-1 text-base text-muted-foreground md:text-sm">{placeholder}</div>}>
                    <MarkdownEditor ref={setEditor} value={value} mentions={mentions} maxLength={maxLength} placeholder={placeholder} autoFocus
                        onChange={(next, nextMentions) => { onValueChange(next, nextMentions); typed(); }}
                        onMentionQuery={editorProps.onMentionQuery} onKeyDown={editorProps.onKeyDown} onImageDrop={onImageDrop}
                        enterKeyHint={submitVerb === 'send' ? 'send' : 'done'}
                        attributes={{
                            ...editorProps.attributes,
                            id: inputId,
                            'data-slot': 'input-group-control',
                            'data-name': name,
                            'aria-label': label,
                            'aria-describedby': `${hintId} ${keysId}`,
                            'aria-invalid': error ? 'true' : undefined
                        }}
                        className="w-full"
                        textClassName="max-h-44 min-h-14 overflow-y-auto px-3 pt-2.5 pb-1 text-base md:text-sm"
                        placeholderClassName="px-3 pt-2.5 text-base text-muted-foreground md:text-sm" />
                </Suspense>
                <InputGroupAddon align="block-end" className="cursor-default justify-between gap-2 py-1.5 pr-1.5 pl-3 font-normal">
                    <div className="flex min-w-0 items-center gap-1">
                        {attachments}
                        <span id={hintId} className={`min-w-0 truncate text-xs tabular-nums ${value.length >= maxLength ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {counting ? <>{value.length}/{maxLength}<span className="sr-only">{t(" characters")}</span></>
                                : mentionsIn && <span className="sr-only">{t("Type @ to mention someone with access.")}</span>}
                        </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                        {onCancel && <Button variant="ghost" size="xs" className="pointer-coarse:min-h-11" onClick={onCancel}>{cancelLabel ?? t("Cancel")}</Button>}
                        {onDiscard && value.length > 0 && <Tooltip>
                            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t("Discard")}
                                className="size-7 rounded-md pointer-coarse:size-11" onClick={onDiscard} />}> <XIcon /> </TooltipTrigger>
                            <TooltipContent>{t("Discard")}</TooltipContent>
                        </Tooltip>}
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
                {submitVerb === 'send' ? t("Enter to send. Shift+Enter for a new line.") : t("Enter to save. Shift+Enter for a new line.")}{escapeCancels && onCancel && t(" Escape to cancel.")}
            </FieldDescription>
            {list}
            {error && <FieldError role="alert">{error}</FieldError>}
            {notices}
        </Field>
        <p role="status" className="sr-only">{mentioned}</p>
        {announcement !== undefined && <p role="status" className="sr-only">{announcement}</p>}
    </form>;
}
