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
const bareUrlPattern = /^https?:\/\/[^\s<>[\]"`-]+/i;
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

const isEmphasis = (mark: Mark) => mark.type === marks.strong || mark.type === marks.em;
/** A mark's opening delimiter; emphasis with `_` when `underscore` (where a `*` would join the delimiter next to it) */
function openMarker(mark: Mark, underscore = false) {
    if (mark.type === marks.link) return '[';
    if (mark.type === marks.strike) return '~~';
    const char = underscore ? '_' : '*';
    return mark.type === marks.strong ? char + char : mark.type === marks.em ? char : '';
}
const closeMarker = (mark: Mark, underscore = false) => mark.type === marks.link ? `](${linkDestination(mark.attrs.href as string)})` : openMarker(mark, underscore);
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

/** An open mark while writing: its closing delimiter and the number of its opening (`span`) */
type OpenMark = { mark: Mark; close: string; span: number };
/**
 * Emphasis closed right before emphasis opens, with nothing between them: `**a*b***` and `*c*` would be one run
 * of `*` that the parser splits its own way. `reopened` are the opened marks that were open before it.
 */
type Joint = { index: number; closed: number; opened: number; reopened: Mark[] };
type InlineOptions = {
    /** Emphasis openings (`span`) written with `_` */
    underscore?: ReadonlySet<number>;
    /** Marks left out from a child on, as long as they last (where they could not be written) */
    drop?: ReadonlyMap<number, readonly Mark[]>;
    /** Marks that open together in the schema's order, instead of the longest lasting first (outside) */
    schemaOrder?: boolean;
};

/** A textblock's inline content as lines (hard breaks end a line), marks as their delimiters */
function inlineLines(block: Node, options: InlineOptions = {}): { lines: Line[]; joints: Joint[]; emphasis: number[]; spans: number; shape: string } {
    const children: Node[] = [];
    block.forEach(child => { children.push(child); });
    // The marks each child is written with: code is a span of its own, and dropped marks stay out while they last
    let dropped: readonly Mark[] = [];
    const written = children.map((child, index) => {
        const own = child.marks.filter(notCode);
        dropped = dropped.filter(mark => mark.isInSet(own)).concat(options.drop?.get(index) ?? []);
        return own.filter(mark => !mark.isInSet(dropped));
    });
    /** How many children from `index` on have the mark (the outer of two marks opened together lasts longer) */
    const extent = (mark: Mark, index: number) => {
        let end = index;
        while (end < children.length && mark.isInSet(written[end]!)) end++;
        return end - index;
    };

    const lines: Line[] = [[]];
    let line = lines[0]!;
    let active: OpenMark[] = [];
    let spans = 0;
    const joints: Joint[] = [];
    const emphasis: number[] = [];
    // Spaces wait for the delimiters next to them: a closing one goes before them and an opening one after,
    // where they keep working (`**a** b`, never `**a **b`)
    let spaces = '';
    // The mark whose closing delimiter was written last, while nothing has followed it
    let closed: OpenMark | undefined;
    const write = (text: string) => {
        if (!text) return;
        // One string with the text before it, so the start of a line is checked as a whole (`escapeLineStart`)
        const last = line.length - 1;
        if (typeof line[last] === 'string') line[last] += text;
        else line.push(text);
        closed = undefined;
    };
    const writeSpaces = () => {
        write(spaces);
        spaces = '';
    };
    /** Closes the open marks from the first one `keep` does not have; returns the marks closed */
    const closeTo = (keep: readonly Mark[]) => {
        const index = active.findIndex(open => !open.mark.isInSet(keep));
        if (index < 0) return [];
        const closing = active.slice(index);
        for (let open = closing.length - 1; open >= 0; open--) write(closing[open]!.close);
        active = active.slice(0, index);
        closed = closing[0];
        return closing.map(open => open.mark);
    };
    /** Opens the child's marks that are not open, the longest lasting first */
    const open = (index: number, closedHere: readonly Mark[]) => {
        const opening = written[index]!
            .filter(mark => !active.some(open => open.mark.eq(mark)))
            .map((mark, order) => ({ mark, order, extent: extent(mark, index) }))
            .sort((a, b) => (options.schemaOrder ? 0 : b.extent - a.extent) || a.order - b.order);
        for (const { mark } of opening) {
            const span = spans++;
            const underscore = options.underscore?.has(span) ?? false;
            if (isEmphasis(mark)) emphasis.push(span);
            if (closed && isEmphasis(closed.mark) && isEmphasis(mark))
                joints.push({ index, closed: closed.span, opened: span, reopened: closedHere.filter(mark => isEmphasis(mark) && mark.isInSet(written[index]!)) });
            write(openMarker(mark, underscore));
            active.push({ mark, close: closeMarker(mark, underscore), span });
        }
    };
    /** The first character after `index`'s node: a delimiter (punctuation) when the marks change */
    const nextChar = (index: number) => {
        const next = children[index + 1];
        if (!next || next.type === nodes.hard_break) return undefined;
        if (!Mark.sameSet(written[index + 1]!, written[index]!) || next.marks.some(mark => mark.type === marks.code)) return '*';
        return next.isText ? next.text![0] : mentionChar;
    };

    children.forEach((node, index) => {
        if (node.type === nodes.hard_break) {
            closeTo([]);
            writeSpaces();
            lines.push(line = []);
            closed = undefined;
            return;
        }
        const own = written[index]!;
        const closedHere = closeTo(own);
        if (node.type === nodes.mention) {
            writeSpaces();
            open(index, closedHere);
            line.push({ mention: node.attrs.id as string, label: node.attrs.label as string });
            closed = undefined;
            return;
        }
        let text = node.text ?? '';
        if (node.marks.some(mark => mark.type === marks.code)) {
            // Code keeps its spaces: the span is padded when it needs to be (`codeSpan`)
            writeSpaces();
            open(index, closedHere);
            write(codeSpan(text));
            return;
        }
        // Spaces alone never open a mark (`** **` would not be bold)
        const leading = /^\s*/.exec(text)![0];
        spaces += leading;
        text = text.slice(leading.length);
        if (!text) return;
        writeSpaces();
        open(index, closedHere);
        const trailing = /\s*$/.exec(text)![0];
        if (trailing) text = text.slice(0, -trailing.length);
        // Before spaces, a closing delimiter can come first (`\\` stays a backslash before it)
        write(escapeText(text, lastChar(line), trailing ? '*' : nextChar(index), active.some(open => open.mark.type === marks.link)));
        spaces += trailing;
    });
    closeTo([]);
    writeSpaces();
    lines.forEach(escapeLineStart);
    return { lines, joints, emphasis, spans, shape: inlineShape(children, index => children[index]!.marks.filter(mark => !notCode(mark) || mark.isInSet(written[index]!))) };
}

/** Lines as text, with each mention's range in it */
function linesText(lines: readonly Line[]): { text: string; mentions: EditorMention[] } {
    let text = '';
    const mentions: EditorMention[] = [];
    lines.forEach((line, index) => {
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

/**
 * A textblock's inline content as what it shows: each character with its marks, spaces without the marks
 * Markdown writes outside them, and no spaces at the edges of a line, where the parser drops them
 */
function inlineShape(children: readonly Node[], marksOf = (index: number) => children[index]!.marks) {
    const parts: string[] = [];
    children.forEach((child, index) => {
        const markNames = (spaces: boolean) => marksOf(index).filter(mark => !spaces || !notCode(mark)).map(mark => mark.type.name + (mark.attrs.href ? `(${mark.attrs.href as string})` : '')).join();
        if (child.type === nodes.hard_break) parts.push('\n');
        else if (child.type === nodes.mention) parts.push(`@${child.attrs.id as string}:${markNames(false)}`);
        else for (const char of child.text ?? '') parts.push(/\s/.test(char) ? `${char}:${markNames(true)}` : `${char}:${markNames(false)}`);
    });
    const blank = (part: string | undefined) => part !== undefined && /^\s:$/.test(part);
    return parts.filter((part, index) => {
        if (!blank(part)) return true;
        let before = index - 1;
        while (blank(parts[before])) before--;
        let after = index + 1;
        while (blank(parts[after])) after++;
        return before >= 0 && after < parts.length && parts[before] !== '\n' && parts[after] !== '\n';
    }).join('|');
}

/**
 * A paragraph's or heading's lines (`finish` adds what the block adds), read back when they have delimiters.
 * Delimiters next to each other can join into runs the parser splits its own way (`**a*b***` and `*c*`), and
 * one next to punctuation may not open or close: when the lines read back differently, `_` is tried for some
 * emphasis, then the marks in the schema's order. When nothing reads back (marks that overlap inside a word,
 * like bold `ab` and italic `bc` in `xabcx`), a reopened mark ends there instead, and failing that, the first
 * lines stay (CommonMark's limits, `message-editor.md`).
 */
function textblockLines(block: Node, finish: (lines: Line[]) => Line[] = lines => lines) {
    const plain = inlineLines(block);
    const first = finish(plain.lines);
    if (!plain.spans) return first;
    const readsBack = (lines: Line[], shape: string) => {
        const { text, mentions } = linesText(lines);
        const read = markdownToDoc(text, mentions).firstChild;
        if (read?.type !== block.type || (block.type === nodes.heading && read.attrs.level !== block.attrs.level)) return false;
        const children: Node[] = [];
        read.forEach(child => { children.push(child); });
        return inlineShape(children) === shape;
    };
    if (readsBack(first, plain.shape)) return first;
    const attempt = (options: InlineOptions, shape: string) => {
        const lines = finish(inlineLines(block, options).lines);
        return readsBack(lines, shape) ? lines : undefined;
    };
    /** `_` for some emphasis: with few, every set of them, the smallest first; with more, one side of every joint (both sides would join again) */
    const underscored = (written: ReturnType<typeof inlineLines>, drop?: ReadonlyMap<number, readonly Mark[]>) => {
        const { emphasis, joints } = written;
        const choices = emphasis.length <= 3
            ? Array.from({ length: 2 ** emphasis.length - 1 }, (_, bits) => emphasis.filter((__, index) => (bits + 1) & (1 << (emphasis.length - 1 - index))))
                .sort((a, b) => a.length - b.length)
            : [joints.map(joint => joint.opened), joints.map(joint => joint.closed)].filter(choice => choice.length);
        for (const choice of choices) {
            const lines = attempt({ drop, underscore: new Set(choice) }, written.shape);
            if (lines) return lines;
        }
        return undefined;
    };
    const dropping = () => {
        const drop = new Map(plain.joints.filter(joint => joint.reopened.length).map(joint => [joint.index, joint.reopened]));
        if (!drop.size) return undefined;
        const written = inlineLines(block, { drop });
        return attempt({ drop }, written.shape) ?? underscored(written, drop);
    };
    return underscored(plain) ?? attempt({ schemaOrder: true }, plain.shape) ?? dropping() ?? first;
}

const prefixed = (prefix: string, line: Line): Line => [prefix, ...line];

function blockLines(block: Node): Line[] {
    switch (block.type) {
        case nodes.paragraph: return block.content.size ? textblockLines(block) : [];
        case nodes.heading: return textblockLines(block, ([line = []]) => {
            // Closing `#`s would be read as the heading's end (spaces after them can be a part of their own)
            let lastIndex = line.length - 1;
            while (lastIndex > 0 && typeof line[lastIndex] === 'string' && !(line[lastIndex] as string).trim()) lastIndex--;
            const last = line[lastIndex];
            if (typeof last === 'string' && /[ \t]#+[ \t]*$/.test(last)) line[lastIndex] = last.replace(/#+([ \t]*)$/, closing => `\\${closing}`);
            return [prefixed('#'.repeat(block.attrs.level as number) + (line.length ? ' ' : ''), line)];
        });
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
    return linesText(blocksLines(parent));
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
