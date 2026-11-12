/**
 * The Markdown a thread message shows (`@uier/toolbar/markdown`), shared by the toolbar's thread and the
 * app's: a small, safe subset that coding agents and people write in chat. Pure and browser/server safe;
 * each side renders the tree with its own React components (`MessageMarkdown`).
 *
 * - Blocks: paragraphs (a line break stays a line break, as in plain text), ATX and setext headings (shown
 *   as bold text), fenced code, block quotes, ordered and unordered lists, thematic breaks.
 * - Inline: strong, emphasis, strikethrough (`~~`), code spans, backslash escapes, links, `<…>` autolinks
 *   and bare http(s) URLs. An image (`![alt](url)`) is a link to it: an image would load a third-party URL
 *   for everyone who reads the thread.
 * - Never HTML: tags are text. Links go only to http, https and mailto URLs; any other link stays the text
 *   it was written as.
 * - Mentions (UTF-16 ranges over the text) are atomic: Markdown never changes or splits them, a name is
 *   never read as Markdown, and in code they show as their text.
 *
 * Indented code blocks, tables, reference links, footnotes and HTML are not supported, by choice: they show
 * as the text they were written as.
 */

/** `id` (the person's) comes back on the mention's node, for a caller that edits the text (`editor/`) */
export type MarkdownMention = { start: number; end: number; name?: string; id?: string };

export type MarkdownInline =
    | { type: 'text'; text: string }
    | { type: 'mention'; text: string; id?: string }
    | { type: 'code'; text: string }
    | { type: 'strong' | 'em' | 'del'; children: MarkdownInline[] }
    /** `href` is an allowed URL; `title` is the full address, when the text shows something else */
    | { type: 'link'; href: string; title?: string; children: MarkdownInline[] };

export type MarkdownBlock =
    | { type: 'paragraph'; children: MarkdownInline[] }
    /** `level`: 1 to 6, the number of `#` (a setext `=` underline is 1, `-` is 2); shown the same, kept for editing */
    | { type: 'heading'; level: number; children: MarkdownInline[] }
    | { type: 'code'; text: string; language?: string }
    | { type: 'quote'; children: MarkdownBlock[] }
    | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
    | { type: 'rule' };

/** Lists and quotes nest this deep; deeper markers are text */
const MAX_DEPTH = 8;
/** Emphasis and links nest this deep; deeper delimiters are text */
const MAX_INLINE_DEPTH = 12;

const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);

/** The address a link may open, normalised, or nothing: http, https and mailto URLs only, never relative ones */
export function safeHref(value: string): string | undefined {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return undefined;
    }
    if (!allowedProtocols.has(url.protocol)) return undefined;
    if (url.protocol === 'mailto:' ? !url.pathname : !url.hostname) return undefined;
    return url.href;
}

// --- Mentions: each range becomes one private use character that the text does not contain

type Mentions = { base: number; texts: string[]; ids: (string | undefined)[] };

function substituteMentions(text: string, mentions: readonly MarkdownMention[] | undefined): { text: string; mentions?: Mentions } {
    const valid: MarkdownMention[] = [];
    let end = 0;
    for (const mention of [...(mentions ?? [])].sort((a, b) => a.start - b.start)) {
        if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < end || mention.end <= mention.start || mention.end > text.length) continue;
        valid.push(mention);
        end = mention.end;
    }
    if (!valid.length) return { text };
    const used = new Set<number>();
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code >= 0xE000 && code <= 0xF8FF) used.add(code);
    }
    let base = 0xE000;
    while (base + valid.length - 1 <= 0xF8FF && valid.some((_, index) => used.has(base + index))) base += valid.length;
    // Over six thousand private use characters in one message: mentions show as their text
    if (base + valid.length - 1 > 0xF8FF) return { text };
    let result = '';
    let at = 0;
    valid.forEach((mention, index) => {
        result += text.slice(at, mention.start) + String.fromCharCode(base + index);
        at = mention.end;
    });
    return {
        text: result + text.slice(at),
        mentions: { base, texts: valid.map(mention => mention.name === undefined ? text.slice(mention.start, mention.end) : `@${mention.name}`), ids: valid.map(mention => mention.id) }
    };
}

function mentionIndex(mentions: Mentions | undefined, char: string) {
    if (!mentions) return -1;
    const index = char.charCodeAt(0) - mentions.base;
    return index >= 0 && index < mentions.texts.length ? index : -1;
}

/** Code shows a mention as the text it stands for */
function restoreMentions(text: string, mentions: Mentions | undefined) {
    if (!mentions) return text;
    let result = '';
    for (const char of text) {
        const index = mentionIndex(mentions, char);
        result += index < 0 ? char : mentions.texts[index];
    }
    return result;
}

// --- Blocks

const fencePattern = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})(.*)$/;
const headingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))??(?:[ \t]+#+)?[ \t]*$/;
const rulePattern = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const setextPattern = /^ {0,3}(=+|-+)[ \t]*$/;
const quotePattern = /^ {0,3}> ?/;
const listItemPattern = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;

const isBlank = (line: string) => /^[ \t]*$/.test(line);

/** Leading tabs as spaces, to the next multiple of four */
function expandIndent(line: string) {
    const match = /^[ \t]+/.exec(line);
    if (!match || !match[0].includes('\t')) return line;
    let width = 0;
    for (const char of match[0]) width = char === '\t' ? width + 4 - (width % 4) : width + 1;
    return ' '.repeat(width) + line.slice(match[0].length);
}

const indentOf = (line: string) => /^ */.exec(line)![0].length;

/** A line that starts another block, so it ends a paragraph */
function interruptsParagraph(line: string, depth: number) {
    if (fencePattern.test(line) || headingPattern.test(line) || rulePattern.test(line)) return true;
    if (depth >= MAX_DEPTH) return false;
    if (quotePattern.test(line)) return true;
    const item = listItemPattern.exec(line);
    // As in CommonMark: a list interrupts a paragraph only with text after its marker, an ordered one only from 1
    return Boolean(item && item[4]?.trim() && (!/\d/.test(item[2]!) || /^1[.)]$/.test(item[2]!)));
}

function parseBlocks(lines: string[], depth: number, mentions: Mentions | undefined): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index]!;
        if (isBlank(line)) {
            index++;
            continue;
        }

        const fence = fencePattern.exec(line);
        if (fence) {
            const indent = fence[1]!.length;
            const marker = fence[2]!;
            const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
            const content: string[] = [];
            index++;
            while (index < lines.length && !closing.test(lines[index]!)) {
                const contentLine = lines[index]!;
                content.push(contentLine.slice(Math.min(indent, indentOf(contentLine))));
                index++;
            }
            index++; // The closing fence; an unclosed fence runs to the end
            const language = fence[3]!.trim().split(/\s/)[0];
            blocks.push({ type: 'code', text: restoreMentions(content.join('\n'), mentions), ...(language ? { language: restoreMentions(language, mentions) } : {}) });
            continue;
        }

        const heading = headingPattern.exec(line);
        if (heading) {
            blocks.push({ type: 'heading', level: heading[1]!.length, children: parseInline(heading[2] ?? '', mentions) });
            index++;
            continue;
        }

        if (rulePattern.test(line)) {
            blocks.push({ type: 'rule' });
            index++;
            continue;
        }

        if (depth < MAX_DEPTH && quotePattern.test(line)) {
            const content: string[] = [];
            while (index < lines.length && quotePattern.test(lines[index]!)) {
                content.push(expandIndent(lines[index]!.replace(quotePattern, '')));
                index++;
            }
            blocks.push({ type: 'quote', children: parseBlocks(content, depth + 1, mentions) });
            continue;
        }

        const item = depth < MAX_DEPTH ? listItemPattern.exec(line) : null;
        if (item) {
            index = parseList(lines, index, depth, mentions, blocks);
            continue;
        }

        // A paragraph: up to a blank line or another block; a setext underline makes it a heading
        const content = [line];
        index++;
        let setext = 0;
        while (index < lines.length && !isBlank(lines[index]!)) {
            const next = lines[index]!;
            if (setextPattern.test(next)) {
                setext = next.trim().startsWith('=') ? 1 : 2;
                index++;
                break;
            }
            if (interruptsParagraph(next, depth)) break;
            content.push(next);
            index++;
        }
        // Lines lose their indentation; spaces at line ends go in parseInline (code keeps them)
        const text = content.map((contentLine, lineIndex) => lineIndex === content.length - 1 ? contentLine.trim() : contentLine.trimStart()).join('\n');
        const children = parseInline(text, mentions);
        blocks.push(setext ? { type: 'heading', level: setext, children } : { type: 'paragraph', children });
    }
    return blocks;
}

/** A list from `start`, appended to `blocks`; returns the index after it */
function parseList(lines: string[], start: number, depth: number, mentions: Mentions | undefined, blocks: MarkdownBlock[]) {
    const first = listItemPattern.exec(lines[start]!)!;
    const ordered = /\d/.test(first[2]!);
    const delimiter = first[2]!.slice(-1);
    const items: MarkdownBlock[][] = [];
    let index = start;
    while (index < lines.length) {
        const item = listItemPattern.exec(lines[index]!);
        if (!item || /\d/.test(item[2]!) !== ordered || item[2]!.slice(-1) !== delimiter || rulePattern.test(lines[index]!)) break;
        const spacing = item[3] ?? '';
        const text = item[4] ?? '';
        // Content starts after the marker and its spaces; five or more spaces are one space and indented text
        const spaces = expandIndent(`${' '.repeat(item[1]!.length + item[2]!.length)}${spacing}`).length - item[1]!.length - item[2]!.length;
        const contentIndent = item[1]!.length + item[2]!.length + (!text || spaces > 4 ? 1 : spaces);
        const content = [spaces > 4 ? ' '.repeat(spaces - 1) + text : text];
        index++;
        while (index < lines.length) {
            const next = expandIndent(lines[index]!);
            if (isBlank(next)) {
                // A blank line continues the item only when indented content follows it
                let after = index + 1;
                while (after < lines.length && isBlank(lines[after]!)) after++;
                if (after < lines.length && indentOf(expandIndent(lines[after]!)) >= contentIndent) {
                    for (; index < after; index++) content.push('');
                    continue;
                }
                break;
            }
            if (indentOf(next) >= contentIndent) {
                content.push(next.slice(contentIndent));
                index++;
                continue;
            }
            // A lazy continuation line of the item's paragraph
            if (listItemPattern.test(next) || interruptsParagraph(next, depth) || isBlank(content[content.length - 1]!)) break;
            content.push(next.trim());
            index++;
        }
        items.push(parseBlocks(content, depth + 1, mentions));
        // Blank lines between items keep the list going
        let after = index;
        while (after < lines.length && isBlank(lines[after]!)) after++;
        if (after > index && after < lines.length && listItemPattern.test(lines[after]!)) index = after;
    }
    blocks.push({ type: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) : 1, items });
    return index;
}

// --- Inline

type Delimiter = { char: string; count: number; length: number; canOpen: boolean; canClose: boolean; node: InlineNode; previous?: Delimiter; next?: Delimiter };
type Bracket = { node: InlineNode; image: boolean; active: boolean; delimiter?: Delimiter; previous?: Bracket };
/** `depth`: how many emphasis and link levels the node holds */
type InlineNode = { inline: MarkdownInline; depth?: number; delimiter?: Delimiter; previous?: InlineNode; next?: InlineNode };

const asciiPunctuation = /[!-/:-@[-`{-~]/;
const isWhitespace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isPunctuation = (char: string | undefined) => char !== undefined && /[\p{P}\p{S}]/u.test(char);
/** Bare URLs end at whitespace, angle brackets, square brackets, quotes, backticks and mentions */
const bareUrlPattern = /^https?:\/\/[^\s<>[\]"`-]+/i;
const trailingUrlPunctuation = /[?!.,:;*_~'"]$/;

function textOf(nodes: MarkdownInline[]): string {
    return nodes.map(node => node.type === 'text' || node.type === 'mention' || node.type === 'code' ? node.text : 'children' in node ? textOf(node.children) : '').join('');
}

/**
 * A link whose text looks like a web address (`https://…`, `www.…`) but opens another site shows the
 * address it opens instead, so the text never misleads. Every link names its full address in `title`
 * when its text shows something else.
 */
function honestLink(href: string, children: MarkdownInline[]): MarkdownInline {
    const text = textOf(children).trim();
    const shown = /^(?:https?:\/\/|www\.)([^/\s?#:]+)/i.exec(text)?.[1]?.toLowerCase().replace(/^www\./, '');
    if (shown) {
        let host = '';
        try { host = new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* safeHref parsed it */ }
        if (host !== shown) return { type: 'link', href, children: [{ type: 'text', text: href }] };
    }
    return text === href ? { type: 'link', href, children } : { type: 'link', href, title: href, children };
}

function parseInline(text: string, mentions: Mentions | undefined): MarkdownInline[] {
    const head: InlineNode = { inline: { type: 'text', text: '' } };
    let tail = head;
    let delimiters: Delimiter | undefined;
    let brackets: Bracket | undefined;
    let buffer = '';
    // Backtick run lengths with no closing run after the current position
    const unclosedCode = new Set<number>();

    const append = (inline: MarkdownInline) => {
        const node: InlineNode = { inline, previous: tail };
        tail.next = node;
        tail = node;
        return node;
    };
    const flush = () => {
        if (buffer) append({ type: 'text', text: buffer });
        buffer = '';
    };
    const removeDelimiter = (delimiter: Delimiter) => {
        if (delimiter.previous) delimiter.previous.next = delimiter.next;
        if (delimiter.next) delimiter.next.previous = delimiter.previous;
        else delimiters = delimiter.previous;
        delimiter.node.delimiter = undefined;
    };
    /** The nodes after `from` up to `to` (exclusive), detached, as finished inlines */
    const detach = (from: InlineNode, to: InlineNode | undefined): MarkdownInline[] => {
        const children: MarkdownInline[] = [];
        for (let node = from.next; node && node !== to; node = node.next) children.push(finish(node));
        return children;
    };
    const finish = (node: InlineNode): MarkdownInline => {
        if (node.delimiter) removeDelimiter(node.delimiter);
        return node.inline;
    };

    /** CommonMark's "process emphasis" above `bottom` */
    const processEmphasis = (bottom: Delimiter | undefined) => {
        // Find the first delimiter above bottom
        let closer = delimiters;
        while (closer && closer.previous !== bottom) closer = closer.previous;
        const openersBottom = new Map<string, Delimiter | undefined>();
        while (closer) {
            if (!closer.canClose) {
                closer = closer.next;
                continue;
            }
            const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.length % 3}`;
            const floor = openersBottom.has(key) ? openersBottom.get(key) : bottom;
            let opener = closer.previous;
            while (opener && opener !== bottom && opener !== floor) {
                // The rule of three, on the runs' original lengths
                const oddMatch = closer.char !== '~' && (opener.canClose || closer.canOpen) && (opener.length + closer.length) % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0);
                if (opener.char === closer.char && opener.canOpen && !oddMatch && (closer.char !== '~' || opener.count === closer.count)) break;
                opener = opener.previous;
            }
            // Nesting deeper than MAX_INLINE_DEPTH leaves the delimiters as text (an opener further down would hold even more)
            let depth = 0;
            if (opener && opener !== bottom && opener !== floor)
                for (let node = opener.node.next; node && node !== closer.node; node = node.next) depth = Math.max(depth, node.depth ?? 0);
            if (!opener || opener === bottom || opener === floor || depth >= MAX_INLINE_DEPTH) {
                openersBottom.set(key, closer.previous);
                const next = closer.next;
                if (!closer.canOpen) removeDelimiter(closer);
                closer = next;
                continue;
            }
            const used = closer.char === '~' ? 2 : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
            opener.count -= used;
            closer.count -= used;
            (opener.node.inline as { text: string }).text = opener.char.repeat(opener.count);
            (closer.node.inline as { text: string }).text = closer.char.repeat(closer.count);
            // Delimiters between them are text now
            for (let between = closer.previous; between && between !== opener; between = between.previous) removeDelimiter(between);
            const type = closer.char === '~' ? 'del' : used === 2 ? 'strong' : 'em';
            const wrapped: InlineNode = { inline: { type, children: detach(opener.node, closer.node) }, depth: depth + 1, previous: opener.node, next: closer.node };
            opener.node.next = wrapped;
            closer.node.previous = wrapped;
            if (opener.count === 0) {
                removeNode(opener.node);
                removeDelimiter(opener);
            }
            if (closer.count === 0) {
                const next = closer.next;
                removeNode(closer.node);
                removeDelimiter(closer);
                closer = next;
            }
        }
        // What is left above bottom is text
        while (delimiters && delimiters !== bottom) removeDelimiter(delimiters);
    };
    const removeNode = (node: InlineNode) => {
        if (node.previous) node.previous.next = node.next;
        if (node.next) node.next.previous = node.previous;
        if (tail === node) tail = node.previous!;
    };

    /** `(destination "title")` after `]`, from `at` (the `(`); the destination and the index after `)` */
    const linkDestination = (at: number): { href: string; end: number } | undefined => {
        let index = at + 1;
        const skipSpace = () => { while (index < text.length && /[ \t\n]/.test(text[index]!)) index++; };
        skipSpace();
        let destination = '';
        if (text[index] === '<') {
            index++;
            while (index < text.length && text[index] !== '>') {
                const char = text[index]!;
                if (char === '\n' || char === '<' || mentionIndex(mentions, char) >= 0) return undefined;
                if (char === '\\' && asciiPunctuation.test(text[index + 1] ?? '')) index++;
                destination += text[index];
                index++;
            }
            if (text[index] !== '>') return undefined;
            index++;
        } else {
            let depth = 0;
            while (index < text.length) {
                const char = text[index]!;
                if (/[\s\x00-\x1f]/.test(char)) break;
                if (mentionIndex(mentions, char) >= 0) return undefined;
                if (char === '\\' && asciiPunctuation.test(text[index + 1] ?? '')) {
                    destination += text[index + 1];
                    index += 2;
                    continue;
                }
                if (char === '(') {
                    if (++depth > 32) return undefined;
                } else if (char === ')') {
                    if (depth === 0) break;
                    depth--;
                }
                destination += char;
                index++;
            }
            if (depth !== 0) return undefined;
        }
        const beforeTitle = index;
        skipSpace();
        // An optional title; the full address is the link's title instead
        const quote = text[index];
        if (index > beforeTitle && (quote === '"' || quote === '\'' || quote === '(')) {
            const close = quote === '(' ? ')' : quote;
            index++;
            while (index < text.length && text[index] !== close) index += text[index] === '\\' ? 2 : 1;
            if (index >= text.length) return undefined;
            index++;
            skipSpace();
        }
        if (text[index] !== ')') return undefined;
        const href = safeHref(destination);
        return href ? { href, end: index + 1 } : undefined;
    };

    let index = 0;
    while (index < text.length) {
        const char = text[index]!;

        if (mentionIndex(mentions, char) >= 0) {
            flush();
            const id = mentions!.ids[mentionIndex(mentions, char)];
            append({ type: 'mention', text: mentions!.texts[mentionIndex(mentions, char)]!, ...(id === undefined ? {} : { id }) });
            index++;
            continue;
        }

        if (char === '\n') {
            // A line break shows as one; spaces before it (a Markdown hard break) do not
            let end = buffer.length;
            while (end > 0 && (buffer[end - 1] === ' ' || buffer[end - 1] === '\t')) end--;
            buffer = buffer.slice(0, end) + char;
            index++;
            continue;
        }

        if (char === '\\') {
            const next = text[index + 1];
            // A backslash before a line break is a hard break: the line break shows anyway
            if (next === '\n') {
                buffer += next;
                index += 2;
                continue;
            }
            if (next !== undefined && asciiPunctuation.test(next)) {
                buffer += next;
                index += 2;
                continue;
            }
            buffer += char;
            index++;
            continue;
        }

        if (char === '`') {
            let run = 1;
            while (text[index + run] === '`') run++;
            let close = -1;
            if (!unclosedCode.has(run)) {
                for (let search = index + run; search < text.length;) {
                    if (text[search] !== '`') {
                        search++;
                        continue;
                    }
                    let length = 1;
                    while (text[search + length] === '`') length++;
                    if (length === run) {
                        close = search;
                        break;
                    }
                    search += length;
                }
                if (close < 0) unclosedCode.add(run);
            }
            if (close < 0) {
                buffer += '`'.repeat(run);
                index += run;
                continue;
            }
            let code = text.slice(index + run, close).replace(/\n/g, ' ');
            if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
            flush();
            append({ type: 'code', text: restoreMentions(code, mentions) });
            index = close + run;
            continue;
        }

        if (char === '*' || char === '_' || char === '~') {
            let run = 1;
            while (text[index + run] === char) run++;
            const before = index > 0 ? text[index - 1] : undefined;
            const after = text[index + run];
            const left = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
            const right = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
            const canOpen = char === '_' ? left && (!right || isPunctuation(before)) : left;
            const canClose = char === '_' ? right && (!left || isPunctuation(after)) : right;
            flush();
            const node = append({ type: 'text', text: char.repeat(run) });
            if ((canOpen || canClose) && (char !== '~' || run === 2)) {
                const delimiter: Delimiter = { char, count: run, length: run, canOpen, canClose, node, previous: delimiters };
                if (delimiters) delimiters.next = delimiter;
                delimiters = delimiter;
                node.delimiter = delimiter;
            }
            index += run;
            continue;
        }

        if (char === '[' || (char === '!' && text[index + 1] === '[')) {
            flush();
            const image = char === '!';
            const node = append({ type: 'text', text: image ? '![' : '[' });
            brackets = { node, image, active: true, delimiter: delimiters, previous: brackets };
            index += image ? 2 : 1;
            continue;
        }

        if (char === ']') {
            const opener = brackets;
            const destination = opener?.active && text[index + 1] === '(' ? linkDestination(index + 1) : undefined;
            if (!opener || !destination) {
                if (opener) brackets = opener.previous;
                buffer += ']';
                index++;
                continue;
            }
            flush();
            processEmphasis(opener.delimiter);
            let depth = 0;
            for (let node = opener.node.next; node; node = node.next) depth = Math.max(depth, node.depth ?? 0);
            // No links inside links: a bare URL in the text is text here
            const children = detach(opener.node, undefined).flatMap(child => child.type === 'link' ? child.children : [child]);
            opener.node.depth = depth + 1;
            opener.node.next = undefined;
            tail = opener.node;
            opener.node.inline = honestLink(destination.href, children.length ? children : [{ type: 'text', text: destination.href }]);
            brackets = opener.previous;
            if (!opener.image) for (let earlier = brackets; earlier; earlier = earlier.previous) if (!earlier.image) earlier.active = false;
            index = destination.end;
            continue;
        }

        if (char === '<') {
            const autolink = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/.exec(text.slice(index, index + 2050))
                ?? /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(text.slice(index, index + 400));
            const address = autolink?.[1];
            const href = address && safeHref(address.includes(':') ? address : `mailto:${address}`);
            if (href && !Array.from(address).some(addressChar => mentionIndex(mentions, addressChar) >= 0)) {
                flush();
                append({ type: 'link', href, children: [{ type: 'text', text: address }] });
                index += autolink![0].length;
                continue;
            }
            buffer += char;
            index++;
            continue;
        }

        if ((char === 'h' || char === 'H') && (index === 0 || /[\s*_~(]/.test(text[index - 1]!))) {
            const match = bareUrlPattern.exec(text.slice(index, index + 2048));
            if (match) {
                let url = match[0];
                for (;;) {
                    if (trailingUrlPunctuation.test(url)) url = url.slice(0, -1);
                    else if (url.endsWith(')') && url.split('(').length < url.split(')').length) url = url.slice(0, -1);
                    else break;
                }
                const href = safeHref(url);
                if (href && /^https?:\/\/[^/?#]/i.test(url)) {
                    flush();
                    append({ type: 'link', href, children: [{ type: 'text', text: url }] });
                    index += url.length;
                    continue;
                }
            }
        }

        buffer += char;
        index++;
    }
    flush();
    processEmphasis(undefined);

    // Adjacent text nodes merge; empty ones (used-up delimiters) go
    const result: MarkdownInline[] = [];
    for (let node = head.next; node; node = node.next) appendInline(result, node.inline);
    return result;
}

function appendInline(result: MarkdownInline[], inline: MarkdownInline) {
    if (inline.type !== 'text') {
        result.push('children' in inline ? { ...inline, children: mergeText(inline.children) } : inline);
        return;
    }
    if (!inline.text) return;
    const last = result[result.length - 1];
    if (last?.type === 'text') result[result.length - 1] = { type: 'text', text: last.text + inline.text };
    else result.push({ type: 'text', text: inline.text });
}

function mergeText(inlines: MarkdownInline[]) {
    const result: MarkdownInline[] = [];
    for (const inline of inlines) appendInline(result, inline);
    return result;
}

/** A message's Markdown as blocks; `mentions` are UTF-16 ranges over `text`, shown as `@name` (or their text) */
export function parseMarkdown(text: string, mentions?: readonly MarkdownMention[]): MarkdownBlock[] {
    const substituted = substituteMentions(text, mentions);
    const lines = substituted.text.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n').map(expandIndent);
    return parseBlocks(lines, 0, substituted.mentions);
}

/** The words of a message without its Markdown, one line per block (list rows' first line) */
export function markdownPlainText(text: string, mentions?: readonly MarkdownMention[]): string {
    const lines: string[] = [];
    const walk = (blocks: MarkdownBlock[]) => {
        for (const block of blocks) {
            if (block.type === 'paragraph' || block.type === 'heading') lines.push(textOf(block.children));
            else if (block.type === 'code') lines.push(block.text);
            else if (block.type === 'quote') walk(block.children);
            else if (block.type === 'list') for (const item of block.items) walk(item);
        }
    };
    walk(parseMarkdown(text, mentions));
    return lines.join('\n');
}
