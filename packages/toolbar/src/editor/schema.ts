import { Schema, type DOMOutputSpec, type Mark, type Node } from 'prosemirror-model';
import { safeHref } from '../markdown';

/**
 * The message editor's document: the Markdown subset a thread message shows (`markdown.ts`), as ProseMirror
 * nodes and marks. Each element has the classes of the rendered message (`MessageMarkdown`, the toolbar's and
 * the app's), so what is written looks as it will read once posted. Blocks are spaced with margins (`space-y-*`;
 * Tailwind's preflight clears the browser's), not a flex gap: a caret in an empty paragraph of a flex container
 * misbehaves in some browsers.
 *
 * Class names are full strings in this file: both Tailwind builds (the toolbar's and the app's, `@source`)
 * read them from here.
 */

const codeClass = 'rounded-sm border border-border bg-muted px-1 font-mono text-[13px]';
const linkClass = 'text-[hsl(var(--brand-accent-text))] underline underline-offset-2';

/** Pasted bold: `<b>`, or a style; Google Docs wraps everything in `<b style="font-weight:normal">` */
const boldWeight = (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null;

export const editorSchema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        // The first block is the default one (a new line, a split)
        paragraph: {
            group: 'block',
            content: 'inline*',
            parseDOM: [{ tag: 'p' }],
            toDOM: (): DOMOutputSpec => ['p', 0]
        },
        heading: {
            group: 'block',
            attrs: { level: { default: 1, validate: 'number' } },
            // One line: a line break would end the heading in Markdown
            content: '(text | mention)*',
            defining: true,
            parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, attrs: { level } })),
            // Bold text, as the message shows every heading
            toDOM: (node: Node): DOMOutputSpec => [`h${node.attrs.level as number}`, { class: 'font-semibold' }, 0]
        },
        code_block: {
            group: 'block',
            content: 'text*',
            marks: '',
            code: true,
            defining: true,
            attrs: { language: { default: '', validate: 'string' } },
            parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
            toDOM: (): DOMOutputSpec => ['pre', { class: 'whitespace-pre-wrap rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[13px] leading-5', spellcheck: 'false' }, ['code', 0]]
        },
        blockquote: {
            group: 'block',
            content: 'block+',
            defining: true,
            parseDOM: [{ tag: 'blockquote' }],
            toDOM: (): DOMOutputSpec => ['blockquote', { class: 'space-y-2 border-l-2 border-border pl-2.5 text-secondary-foreground' }, 0]
        },
        horizontal_rule: {
            group: 'block',
            parseDOM: [{ tag: 'hr' }],
            toDOM: (): DOMOutputSpec => ['hr', { class: 'border-0 border-t border-border' }]
        },
        bullet_list: {
            group: 'block',
            content: 'list_item+',
            parseDOM: [{ tag: 'ul' }],
            toDOM: (): DOMOutputSpec => ['ul', { class: 'list-disc space-y-1 pl-5' }, 0]
        },
        ordered_list: {
            group: 'block',
            content: 'list_item+',
            attrs: { order: { default: 1, validate: 'number' } },
            parseDOM: [{
                tag: 'ol',
                getAttrs: dom => {
                    const start = Number.parseInt(dom.getAttribute('start') ?? '1', 10);
                    return { order: Number.isInteger(start) && start >= 0 && start < 1e9 ? start : 1 };
                }
            }],
            toDOM: (node: Node): DOMOutputSpec => ['ol', { class: 'list-decimal space-y-1 pl-5', start: node.attrs.order === 1 ? null : node.attrs.order as number }, 0]
        },
        list_item: {
            content: 'block+',
            defining: true,
            parseDOM: [{ tag: 'li' }],
            toDOM: (): DOMOutputSpec => ['li', { class: 'space-y-1 pl-0.5 marker:text-muted-foreground' }, 0]
        },
        text: { group: 'inline' },
        hard_break: {
            inline: true,
            group: 'inline',
            selectable: false,
            linebreakReplacement: true,
            parseDOM: [{ tag: 'br' }],
            toDOM: (): DOMOutputSpec => ['br']
        },
        /** A person mentioned: one piece the caret steps over, saved as its text with a range (`docToMarkdown`) */
        mention: {
            inline: true,
            group: 'inline',
            atom: true,
            selectable: false,
            // Code shows a mention as text, so it never takes the code mark
            marks: 'link strong em strike',
            attrs: { id: { validate: 'string' }, label: { validate: 'string' } },
            parseDOM: [{
                tag: 'span[data-mention-id]',
                getAttrs: dom => {
                    const id = dom.getAttribute('data-mention-id');
                    const label = dom.textContent ?? '';
                    return id && label.startsWith('@') ? { id, label } : false;
                }
            }],
            toDOM: (node: Node): DOMOutputSpec => ['span', { 'data-mention': '', 'data-mention-id': node.attrs.id as string }, node.attrs.label as string],
            leafText: (node: Node) => node.attrs.label as string
        }
    },
    // In this order when nested: a link holds bold text, code is innermost
    marks: {
        link: {
            attrs: { href: { validate: 'string' } },
            inclusive: false,
            parseDOM: [{
                tag: 'a[href]',
                getAttrs: dom => {
                    const href = safeHref(dom.getAttribute('href') ?? '');
                    return href ? { href } : false;
                }
            }],
            toDOM: (mark: Mark): DOMOutputSpec => ['a', { href: mark.attrs.href as string, title: mark.attrs.href as string, rel: 'noopener noreferrer nofollow ugc', target: '_blank', class: linkClass }, 0]
        },
        strong: {
            parseDOM: [
                { tag: 'strong' },
                { tag: 'b', getAttrs: dom => dom.style.fontWeight !== 'normal' && null },
                { style: 'font-weight', getAttrs: value => boldWeight(value) }
            ],
            toDOM: (): DOMOutputSpec => ['strong', { class: 'font-semibold' }, 0]
        },
        em: {
            parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }, { style: 'font-style=normal', clearMark: mark => mark.type.name === 'em' }],
            toDOM: (): DOMOutputSpec => ['em', 0]
        },
        strike: {
            parseDOM: [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
            toDOM: (): DOMOutputSpec => ['del', 0]
        },
        code: {
            code: true,
            // Markdown code is literal: no emphasis inside it
            excludes: 'strong em strike',
            parseDOM: [{ tag: 'code' }],
            toDOM: (): DOMOutputSpec => ['code', { class: codeClass, spellcheck: 'false' }, 0]
        }
    }
});

export type EditorNode = Node;
