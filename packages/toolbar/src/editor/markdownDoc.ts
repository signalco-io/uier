import { Fragment, Mark, Slice, type Node } from 'prosemirror-model';
import { parseMarkdown, safeHref, type MarkdownBlock, type MarkdownInline } from '../markdown';
import { editorSchema as schema } from './schema';

/**
 * Between a message's Markdown (what is saved, with mentions as UTF-16 ranges) and the editor's document.
 * Reading uses the messages' own parser (`markdown.ts`), so the editor shows exactly what a posted message
 * shows; writing produces Markdown that the parser reads back as the same document, escaping only what would
 * otherwise turn into formatting. Pure: no DOM, browser and server.
 */

/** A mention in the saved text: the person's id and its UTF-16 range (`@Name`) */
export type EditorMention = { userId: string; start: number; end: number };

const { nodes, marks } = schema;

// --- Markdown to the document

/** Text with its line breaks as hard breaks */
function textNodes(text: string, active: readonly Mark[]): Node[] {
    const result: Node[] = [];
    text.split('\n').forEach((line, index) => {
        if (index > 0) result.push(nodes.hard_break.create());
        if (line) result.push(schema.text(line, active));
    });
    return result;
}

/** A link whose text is its own address (a bare URL or an autolink) is text: the message links it again */
function isAddressText(link: Extract<MarkdownInline, { type: 'link' }>) {
    const [only] = link.children;
    return link.children.length === 1 && only?.type === 'text' && /^https?:\/\//i.test(only.text) && safeHref(only.text) === link.href;
}

function inlineNodes(inlines: readonly MarkdownInline[], active: readonly Mark[]): Node[] {
    return inlines.flatMap(inline => {
        switch (inline.type) {
            case 'text': return textNodes(inline.text, active);
            case 'mention': return inline.id
                ? [nodes.mention.create({ id: inline.id, label: inline.text }, null, nodes.mention.allowedMarks(active))]
                : textNodes(inline.text, active);
            case 'code': return textNodes(inline.text, marks.code.create().addToSet(active));
            case 'strong': return inlineNodes(inline.children, marks.strong.create().addToSet(active));
            case 'em': return inlineNodes(inline.children, marks.em.create().addToSet(active));
            case 'del': return inlineNodes(inline.children, marks.strike.create().addToSet(active));
            case 'link': return isAddressText(inline)
                ? inlineNodes(inline.children, active)
                : inlineNodes(inline.children, marks.link.create({ href: inline.href }).addToSet(active));
        }
    });
}

const paragraph = (content?: Node[]) => nodes.paragraph.create(null, content);

function blockNodes(block: MarkdownBlock): Node[] {
    switch (block.type) {
        case 'paragraph': return [paragraph(inlineNodes(block.children, []))];
        case 'heading': return [nodes.heading.create(
            { level: Math.min(6, Math.max(1, block.level)) },
            // A heading is one line
            inlineNodes(block.children, []).map(node => node.type === nodes.hard_break ? schema.text(' ') : node))];
        case 'code': return [nodes.code_block.create({ language: block.language ?? '' }, block.text ? schema.text(block.text) : null)];
        case 'quote': {
            const children = block.children.flatMap(blockNodes);
            return [nodes.blockquote.create(null, children.length ? children : [paragraph()])];
        }
        case 'list': {
            const items = block.items.map(item => {
                const children = item.flatMap(blockNodes);
                return nodes.list_item.create(null, children.length ? children : [paragraph()]);
            });
            return [block.ordered ? nodes.ordered_list.create({ order: block.start }, items) : nodes.bullet_list.create(null, items)];
        }
        case 'rule': return [nodes.horizontal_rule.create()];
    }
}

/** The editor's document for saved Markdown and its mentions */
export function markdownToDoc(text: string, mentions: readonly EditorMention[] = []): Node {
    const tree = parseMarkdown(text, mentions.map(mention => ({ start: mention.start, end: mention.end, id: mention.userId })));
    const blocks = tree.flatMap(blockNodes);
    // A rule or code block at the end has a paragraph after it to write in (`trailingParagraph`)
    const last = blocks[blocks.length - 1];
    if (!last || last.type === nodes.horizontal_rule || last.type === nodes.code_block) blocks.push(paragraph());
    return nodes.doc.create(null, blocks);
}

/** Pasted or dropped Markdown text, as a slice to insert (one paragraph goes inline) */
export function markdownSlice(text: string): Slice {
    const doc = markdownToDoc(text.replace(/\r\n?/g, '\n'));
    const only = doc.childCount === 1 ? doc.firstChild : null;
    if (only?.type === nodes.paragraph) return new Slice(only.content, 0, 0);
    return Slice.maxOpen(doc.content);
}

// --- The document to Markdown

/** A piece of a line: Markdown text, or a mention (its text, with a range in the result) */
type Part = string | { mention: string; label: string };
type Line = Part[];

const asciiPunctuation = /[!-/:-@[-`{-~]/;
const isWhitespace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isPunctuation = (char: string | undefined) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
// The parser's bare URLs (markdown.ts): the parser links them again, so nothing in them is escaped
const bareUrlPattern = /^https?:\/\/[^\s<>[\]"`-]+/i;
const trailingUrlPunctuation = /[?!.,:;*_~'"]$/;
const autolinkPattern = /^<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\x00-\x20]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

/** The bare URL the parser would link at `index`, as many characters as it takes */
function bareUrlAt(text: string, index: number, before: string | undefined) {
    const char = text[index];
    if ((char !== 'h' && char !== 'H') || (before !== undefined && !/[\s*_~(]/.test(before))) return 0;
    const match = bareUrlPattern.exec(text.slice(index, index + 2048));
    if (!match) return 0;
    let url = match[0];
    for (;;) {
        if (trailingUrlPunctuation.test(url)) url = url.slice(0, -1);
        else if (url.endsWith(')') && url.split('(').length < url.split(')').length) url = url.slice(0, -1);
        else break;
    }
    return safeHref(url) && /^https?:\/\/[^/?#]/i.test(url) ? url.length : 0;
}

/** Whether a run of `*`, `_` or `~` could open or close emphasis, as the parser decides (CommonMark's flanking rules) */
function isDelimiter(char: string, run: number, before: string | undefined, after: string | undefined) {
    if (char === '~' && run !== 2) return false;
    const left = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
    const right = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
    if (char === '_') return (left && (!right || isPunctuation(before))) || (right && (!left || isPunctuation(after)));
    return left || right;
}

/**
 * Text as Markdown that reads back as the same text: a backslash before what would otherwise be formatting,
 * and nothing else (`snake_case`, `2 * 3` and addresses stay as they are). `before` is the character written
 * before it, `after` the one that will follow; in a link's text, brackets are escaped too.
 */
function escapeText(text: string, before: string | undefined, after: string | undefined, inLink: boolean) {
    let result = '';
    const previous = () => result.length ? result[result.length - 1] : before;
    let index = 0;
    while (index < text.length) {
        const char = text[index]!;
        const url = inLink ? 0 : bareUrlAt(text, index, previous());
        if (url) {
            // The parser reads on over characters an address can have, backslashes included: when a backslash
            // will be written after it in that stretch, it goes in `<…>`, where it ends at `>`
            const address = text.slice(index, index + url);
            const rest = text.slice(index + url);
            const stretch = /^[^\s<>[\]"`]*/.exec(rest)![0];
            const stop = stretch.length < rest.length ? rest[stretch.length] : after;
            result += /[*_~\\]/.test(stretch) || (stop !== undefined && '`[]<'.includes(stop)) ? `<${address}>` : address;
            index += url;
            continue;
        }
        const next = index + 1 < text.length ? text[index + 1] : after;
        if (char === '*' || char === '_' || char === '~') {
            let run = 1;
            while (text[index + run] === char) run++;
            const following = index + run < text.length ? text[index + run] : after;
            result += isDelimiter(char, run, previous(), following) ? `\\${char}`.repeat(char === '~' ? 1 : run) + (char === '~' ? char.repeat(run - 1) : '') : char.repeat(run);
            index += run;
            continue;
        }
        if (char === '\\') result += next === undefined || next === '\n' || asciiPunctuation.test(next) ? '\\\\' : '\\';
        else if (char === '`') result += '\\`';
        else if (char === '[') result += inLink ? '\\[' : '[';
        else if (char === ']') result += inLink || next === '(' ? '\\]' : ']';
        else if (char === '<') result += autolinkPattern.test(text.slice(index, index + 2050)) ? '\\<' : '<';
        else result += char;
        index++;
    }
    return result;
}

/** A code span for `text`: a fence longer than any backtick run in it, padded when it starts or ends with one or with spaces */
function codeSpan(text: string) {
    const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim().length > 0);
    return pad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** A link's destination: as it is, or in `<…>` when its parentheses would end it early */
function linkDestination(href: string) {
    let depth = 0;
    for (const char of href) {
        if (char === '(') depth++;
        else if (char === ')' && --depth < 0) break;
    }
    return depth === 0 && !/[\s<>]/.test(href) ? href : `<${href.replace(/[<>\s]/g, encodeURIComponent)}>`;
}

const openMarker = (mark: Mark) => mark.type === marks.link ? '[' : mark.type === marks.strong ? '**' : mark.type === marks.em ? '*' : mark.type === marks.strike ? '~~' : '';
const closeMarker = (mark: Mark) => mark.type === marks.link ? `](${linkDestination(mark.attrs.href as string)})` : openMarker(mark);
const notCode = (mark: Mark) => mark.type !== marks.code;

/** The parser reads a mention as one character that is neither a space nor punctuation, like a letter */
const mentionChar = 'a';

function lastChar(line: Line): string | undefined {
    for (let index = line.length - 1; index >= 0; index--) {
        const part = line[index]!;
        if (typeof part !== 'string') return mentionChar;
        if (part) return part[part.length - 1];
    }
    return undefined;
}

const lineText = (line: Line) => line.map(part => typeof part === 'string' ? part : part.label).join('');

/**
 * A backslash before what would start a block at the start of a line of text (a heading, list, quote, fence,
 * rule or setext underline), so it stays text. Only the line's first text part changes.
 */
function escapeLineStart(line: Line) {
    const first = line[0];
    if (typeof first !== 'string' || !first) return;
    const text = lineText(line);
    const at = (pattern: RegExp, group = 1) => {
        const match = pattern.exec(text);
        return match ? match.index + match[0].indexOf(match[group]!) : -1;
    };
    const position = [
        at(/^ {0,3}(#){1,6}(?:[ \t]|$)/),
        at(/^ {0,3}(>)/),
        at(/^ {0,3}([-+*])(?:[ \t]|$)/),
        at(/^ {0,3}\d{1,9}([.)])(?:[ \t]|$)/),
        at(/^ {0,3}(~){3,}/),
        at(/^ {0,3}([-*_])(?:[ \t]*[-*_]){2,}[ \t]*$/),
        at(/^ {0,3}([=-])[=-]*[ \t]*$/)
    ].find(index => index >= 0);
    if (position !== undefined && position < first.length) line[0] = `${first.slice(0, position)}\\${first.slice(position)}`;
}

/** A textblock's inline content as lines (hard breaks end a line), marks as their delimiters */
function inlineLines(block: Node): Line[] {
    const children: Node[] = [];
    block.forEach(child => { children.push(child); });
    const lines: Line[] = [[]];
    let line = lines[0]!;
    let active: Mark[] = [];
    const write = (text: string) => { if (text) line.push(text); };
    /** Closes the open marks from the first one `keep` does not have */
    const closeTo = (keep: readonly Mark[]) => {
        const index = active.findIndex(mark => !mark.isInSet(keep));
        if (index < 0) return;
        for (let open = active.length - 1; open >= index; open--) write(closeMarker(active[open]!));
        active = active.slice(0, index);
    };
    const open = (wanted: readonly Mark[]) => {
        for (const mark of wanted) {
            if (mark.isInSet(active)) continue;
            write(openMarker(mark));
            active.push(mark);
        }
    };
    /** The first character after `index`'s node: a delimiter (punctuation) when the marks change */
    const nextChar = (index: number, own: readonly Mark[]) => {
        const next = children[index + 1];
        if (!next || next.type === nodes.hard_break) return undefined;
        if (!Mark.sameSet(next.marks.filter(notCode), own.filter(notCode)) || next.marks.some(mark => mark.type === marks.code)) return '*';
        return next.isText ? next.text![0] : mentionChar;
    };

    children.forEach((node, index) => {
        if (node.type === nodes.hard_break) {
            closeTo([]);
            lines.push(line = []);
            return;
        }
        const own = node.marks.filter(notCode);
        const code = node.marks.some(mark => mark.type === marks.code);
        const next = children[index + 1];
        const closesAfter = !next || next.type === nodes.hard_break || active.concat(own).some(mark => !mark.isInSet(next.marks));
        if (node.type === nodes.mention) {
            closeTo(own);
            open(own);
            line.push({ mention: node.attrs.id as string, label: node.attrs.label as string });
            return;
        }
        let text = node.text ?? '';
        closeTo(own);
        if (code) {
            // Code keeps its spaces: the span is padded when it needs to be (`codeSpan`)
            open(own);
            write(codeSpan(text));
            return;
        }
        if (!text.trim()) {
            // Spaces alone never open a mark (`** **` would not be bold)
            write(text);
            return;
        }
        // Spaces at the edges go outside the delimiters, where they keep them working
        const leading = /^\s*/.exec(text)![0];
        if (leading && own.some(mark => !mark.isInSet(active))) {
            write(leading);
            text = text.slice(leading.length);
        }
        open(own);
        const trailing = closesAfter ? /\s*$/.exec(text)![0] : '';
        if (trailing) text = text.slice(0, -trailing.length);
        write(escapeText(text, lastChar(line), trailing ? '*' : nextChar(index, own), active.some(mark => mark.type === marks.link)));
        if (trailing) {
            closeTo(next && next.type !== nodes.hard_break ? next.marks.filter(notCode) : []);
            write(trailing);
        }
    });
    closeTo([]);
    lines.forEach(escapeLineStart);
    return lines;
}

const prefixed = (prefix: string, line: Line): Line => [prefix, ...line];

function blockLines(block: Node): Line[] {
    switch (block.type) {
        case nodes.paragraph: return block.content.size ? inlineLines(block) : [];
        case nodes.heading: {
            const [line = []] = inlineLines(block);
            // Closing `#`s would be read as the heading's end (spaces after them can be a part of their own)
            let lastIndex = line.length - 1;
            while (lastIndex > 0 && typeof line[lastIndex] === 'string' && !(line[lastIndex] as string).trim()) lastIndex--;
            const last = line[lastIndex];
            if (typeof last === 'string' && /[ \t]#+[ \t]*$/.test(last)) line[lastIndex] = last.replace(/#+([ \t]*)$/, closing => `\\${closing}`);
            return [prefixed('#'.repeat(block.attrs.level as number) + (line.length ? ' ' : ''), line)];
        }
        case nodes.code_block: {
            const text = block.textContent;
            const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
            const fence = '`'.repeat(longest + 1);
            const language = block.attrs.language as string;
            return [[fence + (/^[^\s`]+$/.test(language) ? language : '')], ...(text ? text.split('\n').map(codeLine => [codeLine]) : []), [fence]];
        }
        case nodes.blockquote: {
            const lines = blocksLines(block);
            return lines.length ? lines.map(line => line.length ? prefixed('> ', line) : ['>']) : [['>']];
        }
        case nodes.bullet_list:
        case nodes.ordered_list: {
            const lines: Line[] = [];
            let number = block.attrs.order as number ?? 1;
            block.forEach(item => {
                const marker = block.type === nodes.ordered_list ? `${number++}.` : '-';
                const indent = ' '.repeat(marker.length + 1);
                const content = blocksLines(item);
                if (!content.length) lines.push([marker]);
                // `- ---` would be read as a rule, not an item that starts with one
                if (item.firstChild?.type === nodes.horizontal_rule) content[0] = ['***'];
                content.forEach((line, index) => lines.push(index === 0 ? prefixed(`${marker} `, line) : line.length ? prefixed(indent, line) : []));
            });
            return lines;
        }
        case nodes.horizontal_rule: return [['---']];
        default: return [];
    }
}

/** Whether a list starts right under a paragraph line: the parser lets a list end a paragraph when its first item has text */
function interruptsParagraph(list: Node) {
    const first = list.firstChild?.firstChild;
    return (list.type === nodes.bullet_list || list.attrs.order === 1) && first?.type === nodes.paragraph && first.content.size > 0;
}

/**
 * Blocks with a blank line between them; an empty paragraph has no Markdown and is left out. In a list item, a
 * list follows its paragraph on the next line, as people write nested lists.
 */
function blocksLines(parent: Node): Line[] {
    const lines: Line[] = [];
    let previous: Node | undefined;
    parent.forEach(child => {
        const own = blockLines(child);
        if (!own.length) return;
        const tight = parent.type === nodes.list_item && previous?.type === nodes.paragraph && (child.type === nodes.bullet_list || child.type === nodes.ordered_list) && interruptsParagraph(child);
        if (lines.length && !tight) lines.push([]);
        lines.push(...own);
        previous = child;
    });
    return lines;
}

/** The Markdown of a document (or of block content), with each mention's range in it */
export function docToMarkdown(doc: Node | Fragment): { text: string; mentions: EditorMention[] } {
    const parent = doc instanceof Fragment ? nodes.doc.create(null, doc) : doc;
    let text = '';
    const mentions: EditorMention[] = [];
    blocksLines(parent).forEach((line, index) => {
        if (index > 0) text += '\n';
        for (const part of line) {
            if (typeof part === 'string') {
                text += part;
                continue;
            }
            mentions.push({ userId: part.mention, start: text.length, end: text.length + part.label.length });
            text += part.label;
        }
    });
    return { text, mentions };
}

/** Copied content as Markdown text (for other apps; the editor itself pastes its own HTML) */
export function sliceToMarkdown(slice: Slice): string {
    const content = slice.content;
    const first = content.firstChild;
    try {
        const blocks = first?.isInline ? Fragment.from(nodes.paragraph.createChecked(null, content))
            : first?.type === nodes.list_item ? Fragment.from(nodes.bullet_list.createChecked(null, content))
            : content;
        return docToMarkdown(nodes.doc.createChecked(null, blocks)).text;
    } catch {
        return content.textBetween(0, content.size, '\n\n', node => node.type === nodes.hard_break ? '\n' : node.type === nodes.mention ? node.attrs.label as string : '');
    }
}

/** Whether a document has nothing to send: one empty paragraph */
export function isEmptyDoc(doc: Node) {
    return doc.childCount === 1 && doc.firstChild!.type === nodes.paragraph && doc.firstChild!.content.size === 0;
}
