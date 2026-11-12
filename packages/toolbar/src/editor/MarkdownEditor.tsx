'use client';

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Fragment, Slice, type Node, type ResolvedPos } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { EditorView } from 'prosemirror-view';
import { history } from 'prosemirror-history';
import { safeHref } from '../markdown';
import { editorSchema as schema } from './schema';
import { docToMarkdown, isEmptyDoc, markdownSlice, markdownToDoc, sliceToMarkdown, type EditorMention } from './markdownDoc';
import { editorKeymap, markdownInputRules, newLine, trailingParagraph } from './commands';

/** The `@` being typed before the caret: where it starts and ends, and what follows it (lower case) */
export type MentionQuery = { from: number; to: number; search: string };

export type MarkdownEditorHandle = {
    /** Focuses the text; `end` puts the caret after the last character */
    focus: (at?: 'end') => void;
    /** Replaces the text as if it was typed: one step in the undo history, the focus in the text */
    replaceText: (text: string) => void;
    /** Puts the person in place of the `@` being typed, and a space after; false when it does not fit */
    insertMention: (person: { id: string; name: string }) => boolean;
    /** The text box (the editable element) */
    readonly element: HTMLElement | null;
};

export type MarkdownEditorProps = {
    ref?: Ref<MarkdownEditorHandle>;
    /** The text as Markdown, with its mentions' ranges; it follows when they change from outside */
    value: string;
    mentions?: readonly EditorMention[];
    /** Every change, as Markdown with the mentions' ranges */
    onChange: (value: string, mentions: EditorMention[]) => void;
    /** Longest Markdown it takes; input that would make it longer is not taken */
    maxLength?: number;
    /** Keeps its place and can have the focus, but takes no input */
    readOnly?: boolean;
    placeholder?: string;
    /** Focus with the caret at the end once it is there */
    autoFocus?: boolean;
    /** The text box's attributes: `id`, `aria-label`, `aria-describedby`, the mention list's `aria-*`... */
    attributes?: Record<string, string | undefined>;
    /** The virtual keyboard's Enter key */
    enterKeyHint?: 'send' | 'done' | 'enter';
    /**
     * Keys before the editor's own (a mention list, Enter to send, Escape): return true when handled. Shift+Enter
     * is a new line unless this takes it.
     */
    onKeyDown?: (event: KeyboardEvent) => boolean;
    /** The `@` being typed before the caret changed (none: undefined) */
    onMentionQuery?: (query: MentionQuery | undefined) => void;
    /** An image file dropped on the text; any dropped file is never put in the text or opened */
    onImageDrop?: (file: File) => void;
    /** The box around the text box (the placeholder is positioned in it) */
    className?: string;
    /** The text box: its padding, height and scrolling */
    textClassName?: string;
    /** The placeholder over an empty text box: the same padding as the text, and its colour */
    placeholderClassName?: string;
};

/** What the editor needs at the start, besides the schema: the classes ProseMirror needs (prosemirror-view/style) */
const editableClassName = [
    'block w-full min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none space-y-2',
    '[font-variant-ligatures:none] [font-feature-settings:"liga"_0]',
    '[&_li]:relative [&_img.ProseMirror-separator]:inline! [&_img.ProseMirror-separator]:m-0! [&_img.ProseMirror-separator]:border-0!',
    '[&.ProseMirror-hideselection]:caret-transparent [&.ProseMirror-hideselection_*::selection]:bg-transparent',
    '[&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-offset-2 [&_.ProseMirror-selectednode]:outline-ring'
].join(' ');

const serialized = new WeakMap<Node, ReturnType<typeof docToMarkdown>>();
function markdownOf(doc: Node) {
    let result = serialized.get(doc);
    if (!result) {
        result = docToMarkdown(doc);
        serialized.set(doc, result);
    }
    return result;
}

/** The `@` query before the caret: `@` at the start or after a space, up to 80 characters, never in code */
function mentionQueryAt(state: EditorState): MentionQuery | undefined {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.spec.code || $from.marks().some(mark => mark.type === schema.marks.code)) return undefined;
    // Each mention or line break is one character, as it is one position
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 82), $from.parentOffset, undefined, '￼');
    const match = /(?:^|\s)@([^@\n￼]{0,80})$/.exec(before);
    if (!match) return undefined;
    return { from: $from.pos - match[1]!.length - 1, to: $from.pos, search: match[1]!.toLocaleLowerCase() };
}

/** Text pasted as text (Shift+Ctrl+V): paragraphs at blank lines, line breaks kept, no Markdown read from it */
function plainTextSlice(text: string): Slice {
    const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(paragraph => schema.nodes.paragraph.create(null,
        paragraph.split('\n').flatMap((line, index) => [...(index ? [schema.nodes.hard_break.create()] : []), ...(line ? [schema.text(line)] : [])])));
    return paragraphs.length === 1 ? new Slice(paragraphs[0]!.content, 0, 0) : new Slice(Fragment.from(paragraphs), 1, 1);
}

/** A leaf's text where it is plain text: a line break, a mention's name */
const leafText = (node: Node) => node.type === schema.nodes.hard_break ? '\n' : node.type === schema.nodes.mention ? node.attrs.label as string : '';

/** Styled lines from a code editor (VS Code, JetBrains): their text is what was meant, as Markdown */
const codeEditorHtml = /white-space:\s*pre/i;

/** ProseMirror's `focus` leaves a read-only view alone; it still takes the focus (as a read-only textarea does) */
function focusView(view: EditorView) {
    if (view.editable) view.focus();
    else view.dom.focus({ preventScroll: true });
}

/** Text selected outside the editor and the toolbar around it (on the page) */
function selectedElsewhere(view: EditorView) {
    const selection = view.dom.ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    if (!selection || selection.isCollapsed || !anchor) return false;
    const root = view.dom.getRootNode();
    // A selection in a shadow root reads as the host's parent from the document
    return !view.dom.contains(anchor) && !(root instanceof ShadowRoot && anchor.contains(root.host));
}

/**
 * After a redraw, the editor that had the focus keeps it (with its caret), unless something else has been
 * selected since: a page's text selected while a closing popover still held the editor stays selected.
 * `domSelectionRange` is ProseMirror's own (it reads a shadow root's selection too); the version is pinned
 */
function keepFocus(view: EditorView) {
    const range = (view as unknown as { domSelectionRange?: () => { anchorNode: globalThis.Node | null } }).domSelectionRange?.();
    const anchor = range?.anchorNode;
    if (anchor && !view.dom.contains(anchor)) return;
    focusView(view);
}

const sameQuery = (a: MentionQuery | undefined, b: MentionQuery | undefined) => a?.from === b?.from && a?.to === b?.to && a?.search === b?.search;

/**
 * The message editor of every composer (the toolbar's `CommentComposer`, the app's `MessageComposer`): rich text
 * that is saved as Markdown. Markdown typed as you write becomes formatting (`# `, `- `, `1. `, `> `, `---`,
 * `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`), Ctrl/⌘+B, I, E and Shift+X format the
 * selection (`commands.ts`), pasted Markdown text is formatted, and the document looks like the posted message.
 * Mentions are single pieces with the person's id. Enter belongs to the form (`onKeyDown`).
 *
 * ProseMirror, in a `contenteditable` with `role="textbox"`: it reads the browser's input itself, so a
 * phone's keyboard, composition (IME), autocorrect and dictation work as in any text box, and it works in the
 * toolbar's shadow root. The document is only replaced when `value` changes from outside (a sent or discarded
 * draft, another tab): what it reports itself is never read back.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
    const { ref, value, mentions, placeholder, className, placeholderClassName } = props;
    const mountRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    /** The text the editor has: as it reported it, or as it was given */
    const lastValue = useRef(value);
    const lastQuery = useRef<MentionQuery | undefined>(undefined);
    const [empty, setEmpty] = useState(() => !value);

    const attributes = (): Record<string, string> => {
        const current = propsRef.current;
        const own: Record<string, string | undefined> = {
            ...current.attributes,
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-readonly': current.readOnly ? 'true' : undefined,
            'aria-placeholder': current.placeholder,
            // Focusable while read-only too (a reply box waiting for its comment)
            tabindex: '0',
            enterkeyhint: current.enterKeyHint,
            autocapitalize: 'sentences',
            autocorrect: 'on',
            spellcheck: 'true',
            'data-uier-editor': '',
            class: `${editableClassName} ${current.textClassName ?? ''}`
        };
        return Object.fromEntries(Object.entries(own).filter((entry): entry is [string, string] => entry[1] !== undefined));
    };
    const attributesKey = JSON.stringify(attributes()) + String(props.readOnly);

    const createState = (doc: Node) => EditorState.create({
        doc,
        selection: Selection.atEnd(doc),
        plugins: [
            history(),
            markdownInputRules,
            ...editorKeymap,
            trailingParagraph
        ]
    });

    const report = (state: EditorState) => {
        setEmpty(isEmptyDoc(state.doc));
        const query = mentionQueryAt(state);
        if (!sameQuery(query, lastQuery.current)) {
            lastQuery.current = query;
            propsRef.current.onMentionQuery?.(query);
        }
    };

    useLayoutEffect(() => {
        const mount = mountRef.current!;
        const longer = (doc: Node, than: Node) => {
            const max = propsRef.current.maxLength;
            const length = markdownOf(doc).text.length;
            return max !== undefined && length > max && length > markdownOf(than).text.length;
        };
        /**
         * Text that would make it too long, as much of it as fits (as a textarea's maxLength): the transaction for
         * the longest start of `text` (as `make` inserts it) that keeps the Markdown within the limit
         */
        const fitting = (state: EditorState, text: string, make: (part: string) => Transaction) => {
            let low = 0;
            let high = text.length - 1;
            let best: Transaction | undefined;
            while (low <= high) {
                const middle = (low + high) >> 1;
                const tr = make(text.slice(0, middle));
                if (longer(tr.doc, state.doc)) high = middle - 1;
                else {
                    best = tr;
                    low = middle + 1;
                }
            }
            return best;
        };
        const view = new EditorView({ mount }, {
            state: createState(markdownToDoc(lastValue.current, propsRef.current.mentions)),
            attributes,
            editable: () => !propsRef.current.readOnly,
            dispatchTransaction(tr) {
                // Over the limit: the change is not taken (as a textarea's maxLength); typed text the page
                // already shows is redrawn away (ProseMirror marked it dirty). Text that replaced a stretch (typed
                // or filled over a selection of several blocks) goes in as far as it fits
                if (tr.docChanged && longer(tr.doc, view.state.doc)) {
                    const step = tr.steps.length === 1 ? tr.steps[0] : undefined;
                    const inserted = step instanceof ReplaceStep ? step.slice.content.textBetween(0, step.slice.content.size, '\n\n', leafText) : '';
                    const { state } = view;
                    const fit = step instanceof ReplaceStep && inserted
                        ? fitting(state, inserted, part => state.tr.replaceRange(step.from, step.to, plainTextSlice(part)))
                        : undefined;
                    if (fit?.docChanged) view.dispatch(fit.scrollIntoView());
                    else view.updateState(state);
                    return;
                }
                const state = view.state.apply(tr);
                view.updateState(state);
                if (tr.docChanged) {
                    const markdown = markdownOf(state.doc);
                    lastValue.current = markdown.text;
                    propsRef.current.onChange(markdown.text, markdown.mentions);
                }
                report(state);
            },
            // A key that is part of a composition (an IME) is the composition's: never a shortcut or a send
            handleKeyDown: (_view, event) => event.isComposing || (propsRef.current.onKeyDown?.(event) ?? false),
            handleTextInput(inputView, from, to, text) {
                const { state } = inputView;
                if (!longer(state.tr.insertText(text, from, to).doc, state.doc)) return false;
                const fit = fitting(state, text, part => state.tr.insertText(part, from, to));
                if (fit) inputView.dispatch(fit.scrollIntoView());
                else inputView.updateState(state);
                return true;
            },
            clipboardTextSerializer: slice => sliceToMarkdown(slice),
            // Text is Markdown, as it was in a plain text box; Shift+Ctrl+V pastes it as it is
            clipboardTextParser: (text, _context: ResolvedPos, plain) => plain ? plainTextSlice(text) : markdownSlice(text),
            handlePaste(pasteView, event, slice) {
                const data = event.clipboardData;
                if (!data) return false;
                const text = data.getData('text/plain');
                // An image alone is the form's to attach (`useAttachedImage`'s paste handler)
                if (!text && [...data.files].some(file => file.type.startsWith('image/'))) return true;
                const { state } = pasteView;
                if (!text || state.selection.$from.parent.type.spec.code) return false;
                // An address pasted over selected text links it
                const address = text.trim();
                const href = !/\s/.test(address) && /^(https?|mailto):/i.test(address) ? safeHref(address) : undefined;
                if (href && !state.selection.empty && !state.selection.$from.parent.type.spec.code) {
                    pasteView.dispatch(state.tr.addMark(state.selection.from, state.selection.to, schema.marks.link.create({ href })));
                    return true;
                }
                const html = data.getData('text/html');
                const parsed = html && !html.includes('data-pm-slice') && codeEditorHtml.test(html) ? markdownSlice(text) : slice;
                const pasted = state.tr.replaceSelection(parsed);
                if (!longer(pasted.doc, state.doc)) {
                    if (parsed === slice) return false;
                    pasteView.dispatch(pasted.scrollIntoView());
                    return true;
                }
                // Too long: as much of its text as fits, as a textarea takes it
                const fit = fitting(state, text, part => state.tr.replaceSelection(plainTextSlice(part)));
                if (fit) pasteView.dispatch(fit.scrollIntoView());
                return true;
            },
            handleDrop(_view, event) {
                const files = [...(event.dataTransfer?.files ?? [])];
                if (!files.length) return false;
                const image = files.find(file => file.type.startsWith('image/'));
                if (image) propsRef.current.onImageDrop?.(image);
                return true;
            },
            handleDOMEvents: {
                // Escape is the page's (a popover or modal closes) unless `onKeyDown` takes it: ProseMirror's own
                // handling would cancel it for everyone
                keydown(keyView, event) {
                    if (event.isComposing || event.keyCode === 229) return false;
                    // A selection made just before the key (by a script, or a test's fill) may not have reached the
                    // state yet (`selectionchange` comes later): read it, so the key acts on what is selected.
                    // `domObserver` is ProseMirror's own (not in its types); the version is pinned
                    (keyView as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
                    // Shift+Enter (a hardware keyboard's) is a new line: ProseMirror leaves Enter to the browser on
                    // Android and iOS, reads the change and then calls it plain Enter, which sends
                    if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                        if (!keyView.editable) return false;
                        if (!propsRef.current.onKeyDown?.(event)) newLine(keyView.state, keyView.dispatch);
                        event.preventDefault();
                        return true;
                    }
                    if (event.key !== 'Escape') return false;
                    if (propsRef.current.onKeyDown?.(event)) event.preventDefault();
                    return true;
                },
                // Lets a file be dropped here (the drop is `handleDrop`'s)
                dragover(_view, event) {
                    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
                    return false;
                }
            }
        });
        viewRef.current = view;
        report(view.state);
        if (propsRef.current.autoFocus) focusView(view);
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    // The view is made once; it reads the props through propsRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A new value from outside (sent, discarded, restored, another tab): a fresh document, the caret at its end
    const mentionsKey = (mentions ?? []).map(mention => `${mention.userId}:${mention.start}:${mention.end}`).join(',');
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view || value === lastValue.current) return;
        lastValue.current = value;
        const doc = markdownToDoc(value, mentions);
        if (doc.eq(view.state.doc)) return;
        const focused = view.hasFocus();
        view.updateState(createState(doc));
        report(view.state);
        if (focused) keepFocus(view);
    // `mentions` come with `value`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, mentionsKey]);

    // Attributes and read-only follow the props
    const appliedAttributes = useRef(attributesKey);
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view || appliedAttributes.current === attributesKey) return;
        appliedAttributes.current = attributesKey;
        let focused = view.hasFocus() || view.dom === view.root.activeElement;
        // A focused element that becomes editable takes the document's selection: text selected on the page since
        // (while a closing popover still held this one) stays selected, and the focus goes with it
        if (focused && !view.editable && !propsRef.current.readOnly && selectedElsewhere(view)) {
            view.dom.blur();
            focused = false;
        }
        view.updateState(view.state);
        if (focused && !propsRef.current.readOnly) keepFocus(view);
    }, [attributesKey]);

    useImperativeHandle(ref, () => ({
        focus: at => {
            const view = viewRef.current;
            if (!view) return;
            if (at === 'end') view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
            focusView(view);
        },
        replaceText: text => {
            const view = viewRef.current;
            if (!view) return;
            const doc = markdownToDoc(text);
            const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
            view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView());
            view.focus();
        },
        insertMention: person => {
            const view = viewRef.current;
            const query = view && mentionQueryAt(view.state);
            if (!view || !query) return false;
            const { state } = view;
            const marks = schema.nodes.mention.allowedMarks(state.storedMarks ?? state.doc.resolve(query.from).marks());
            const tr = state.tr.replaceWith(query.from, query.to, [schema.nodes.mention.create({ id: person.id, label: `@${person.name}` }, null, marks), schema.text(' ', marks)]);
            tr.setSelection(TextSelection.create(tr.doc, query.from + 2));
            const before = state.doc;
            view.dispatch(tr.scrollIntoView());
            view.focus();
            return view.state.doc !== before;
        },
        get element() {
            return viewRef.current?.dom ?? null;
        }
    }), []);

    return (
        <div className={`relative ${className ?? ''}`}>
            <div ref={mountRef} />
            {empty && placeholder && (
                <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 select-none truncate ${placeholderClassName ?? ''}`}>
                    {placeholder}
                </div>
            )}
        </div>
    );
}
