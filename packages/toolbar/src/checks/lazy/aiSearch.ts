import { foundLine, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import type { CheckState, PageCheck, PageIssue } from '../types';
import { words as lt } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// AI search (packages/toolbar/docs/page-checks-ai-search.md): what an AI reads of the page (its main
// content as Markdown, from the document as rendered in this browser), and whether the page says who
// wrote it, when, and who publishes it. Facts about the page only: nothing here says what an AI does.

/** Where the main content was read from */
export type ContentRoot = 'main' | 'article' | 'body';

export type AiSearchDetails = {
    /** The main content as Markdown, at most `markdownLimit` characters */
    markdown: string;
    /** Cut at the character or element limit */
    truncated: boolean;
    root: ContentRoot;
    /** The page's title and meta description as they are now, for AI suggestions */
    title: string;
    description: string;
};

export type AiSearchReport = SectionReport<AiSearchDetails>;

const markdownLimit = 40_000;
const elementLimit = 20_000;
/** Hidden text shorter than this (an icon's label, "Copied") is not a block of text */
const hiddenTextMinimum = 20;
/** Fewer words in the main content is a note */
const littleText = 100;
/** An `article` element this long makes the page article-like */
const articleWords = 200;


// --- Reading the document

type Walk = {
    chars: number;
    elements: number;
    stopped: boolean;
    /** Skip page chrome (the body fallback) */
    chrome: boolean;
    headings: number;
    imagesWithoutAlt: number;
    frames: number;
    canvases: number;
    hiddenBlocks: number;
};

const ignored = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'svg', 'math', 'audio', 'video', 'select', 'datalist', 'input', 'textarea', 'head', 'title']);
const frames = new Set(['iframe', 'frame', 'object', 'embed']);
const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'center', 'details', 'div', 'dl', 'dd', 'dt', 'fieldset', 'figcaption', 'figure',
    'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section',
    'summary', 'table', 'ul', 'caption']);
const chromeRoles = /^(navigation|banner|contentinfo|complementary|search|form)$/;

/** Whether the element is in the page's layout now; `display: contents` is followed into its children */
function visibility(element: Element): 'visible' | 'contents' | 'hidden' {
    if (element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return 'visible';
    return getComputedStyle(element).display === 'contents' ? 'contents' : 'hidden';
}

/** The page's navigation, header, footer, aside and forms, left out when the body is read */
function isChrome(element: Element) {
    const name = element.localName;
    if (name === 'nav' || name === 'aside' || name === 'form') return true;
    if (chromeRoles.test(element.getAttribute('role') ?? '')) return true;
    // A header or footer of the page, not of an article or section
    return (name === 'header' || name === 'footer') && !element.parentElement?.closest('article, section, main, [role="main"]');
}

/**
 * What to do with an element: leave it out (not text, the toolbar, chrome, too much), count it as
 * text the page hides right now, or read it
 */
function admit(element: Element, walk: Walk): 'read' | 'contents' | 'skip' {
    if (walk.stopped) return 'skip';
    if (++walk.elements > elementLimit) {
        walk.stopped = true;
        return 'skip';
    }
    const name = element.localName;
    if (ignored.has(name)) return 'skip';
    if ((element.id === 'uier-toolbar' || element.hasAttribute('data-uier-thread')) && isToolbarNode(element)) return 'skip';
    if (walk.chrome && isChrome(element)) return 'skip';
    const shown = visibility(element);
    if (shown === 'hidden') {
        if (oneLine(element.textContent, hiddenTextMinimum).length >= hiddenTextMinimum) walk.hiddenBlocks++;
        return 'skip';
    }
    if (frames.has(name)) {
        walk.frames++;
        return 'skip';
    }
    if (name === 'canvas') {
        walk.canvases++;
        return 'skip';
    }
    return shown === 'visible' ? 'read' : 'contents';
}

/** Text without its markup's white space: one space for every run */
const squash = (text: string) => text.replace(/[ \t\r\n\f\u00a0]+/g, ' ');

/** A destination for Markdown: spaces and parentheses would end it */
const destination = (address: string) => address.replace(/[ ()]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const bracketed = (text: string) => text.replace(/[[\]]/g, '\\$&');

function codeSpan(text: string) {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const fence = '`'.repeat(longest + 1);
    return longest ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function image(element: Element, walk: Walk) {
    const alt = element.getAttribute('alt');
    if (alt === null) {
        // Decoration says nothing on purpose
        if (!/^(presentation|none)$/.test(element.getAttribute('role') ?? '') && !element.closest('[aria-hidden="true"]')) walk.imagesWithoutAlt++;
        return '';
    }
    const text = oneLine(alt, 300);
    const source = element instanceof HTMLImageElement ? element.getAttribute('src') || element.currentSrc : '';
    return text ? `![${bracketed(text)}](${destination(writtenAddress(source))})` : '';
}

/** Phrasing content as Markdown, on one line except where the page breaks it (`br`) */
function inline(parent: Element, walk: Walk): string {
    let text = '';
    for (const node of parent.childNodes) {
        if (walk.stopped) break;
        if (node.nodeType === Node.TEXT_NODE) {
            text += squash((node as Text).data);
            continue;
        }
        if (!(node instanceof Element)) continue;
        const admitted = admit(node, walk);
        if (admitted === 'skip') continue;
        const content = admitted === 'contents' ? inline(node, walk) : inlineElement(node, walk);
        // A block inside phrasing content (a card inside a link) is a word of its own
        text += blocks.has(node.localName) ? ` ${content} ` : content;
    }
    return text;
}

/** Emphasis around the text, outside its spaces (`**bold** text`, never `** bold **`) */
function wrapped(text: string, mark: string) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    return match[2] ? `${match[1]}${mark}${match[2]}${mark}${match[3]}` : text;
}

function inlineElement(element: Element, walk: Walk): string {
    switch (element.localName) {
        case 'br': return '\n';
        case 'wbr': return '';
        case 'img': return image(element, walk);
        case 'strong': case 'b': return wrapped(inline(element, walk), '**');
        case 'em': case 'i': return wrapped(inline(element, walk), '*');
        case 's': case 'del': return wrapped(inline(element, walk), '~~');
        case 'code': case 'kbd': case 'samp': {
            const text = squash(element.textContent ?? '').trim();
            return text ? codeSpan(text) : '';
        }
        case 'a': {
            const text = line(inline(element, walk));
            const href = element.getAttribute('href')?.trim();
            if (!text || !href || /^javascript:/i.test(href)) return text;
            return `[${text.startsWith('![') ? text : bracketed(text)}](${destination(writtenAddress(href))})`;
        }
        default: return inline(element, walk);
    }
}

/** Inline Markdown as it ends up in a paragraph: one space between words, no space around its lines */
const paragraph = (text: string) => text.split('\n').map(part => part.replace(/ {2,}/g, ' ').trim()).filter(Boolean).join('\n');
const line = (text: string) => paragraph(text).replace(/\n/g, ' ');

/** Adds a finished block, counted against the limit */
function push(out: string[], text: string, walk: Walk) {
    if (!text) return;
    walk.chars += text.length + 2;
    if (walk.chars > markdownLimit) walk.stopped = true;
    out.push(text);
}

/** The children of a block element as Markdown blocks: runs of phrasing content become paragraphs */
function children(parent: Element, walk: Walk, out: string[] = []): string[] {
    let run = '';
    const flush = () => {
        push(out, paragraph(run), walk);
        run = '';
    };
    for (const node of parent.childNodes) {
        if (walk.stopped) break;
        if (node.nodeType === Node.TEXT_NODE) {
            run += squash((node as Text).data);
            if (run.length > markdownLimit) walk.stopped = true;
            continue;
        }
        if (!(node instanceof Element)) continue;
        const admitted = admit(node, walk);
        if (admitted === 'skip') continue;
        if (admitted === 'contents') {
            // Its children belong to this run or are blocks of their own
            flush();
            children(node, walk, out);
            continue;
        }
        if (blocks.has(node.localName)) {
            flush();
            block(node, walk, out);
        } else {
            run += inlineElement(node, walk);
        }
    }
    flush();
    return out;
}

const indent = (text: string, by: string) => text.split('\n').map((part, index) => index && part ? `${by}${part}` : part).join('\n');

function list(element: Element, walk: Walk, out: string[]) {
    const ordered = element.localName === 'ol';
    let number = ordered ? Number.parseInt(element.getAttribute('start') ?? '1', 10) || 1 : 0;
    const items: string[] = [];
    for (const item of element.children) {
        if (walk.stopped) break;
        if (admit(item, walk) === 'skip') continue;
        const marker = ordered ? `${number++}.` : '-';
        // A tight list: the item's blocks on lines of their own, under its text
        const content = children(item, walk).join('\n');
        if (content) items.push(`${marker} ${indent(content, ' '.repeat(marker.length + 1))}`);
    }
    if (items.length) out.push(items.join('\n'));
}

function table(element: HTMLTableElement, walk: Walk, out: string[]) {
    const caption = element.caption && admit(element.caption, walk) !== 'skip' ? line(inline(element.caption, walk)) : '';
    if (caption) push(out, caption, walk);
    const rows: string[][] = [];
    for (const row of element.rows) {
        if (walk.stopped) break;
        if (admit(row, walk) === 'skip') continue;
        const cells: string[] = [];
        for (const cell of row.cells) {
            const text = admit(cell, walk) === 'skip' ? '' : line(inline(cell, walk)).replace(/\|/g, '\\|');
            cells.push(text, ...Array<string>(Math.max(0, Math.min(cell.colSpan, 20) - 1)).fill(''));
        }
        if (cells.some(Boolean)) rows.push(cells);
    }
    if (!rows.length) return;
    const columns = Math.max(...rows.map(row => row.length));
    const written = (row: string[]) => `| ${Array.from({ length: columns }, (_, index) => row[index] ?? '').join(' | ')} |`;
    push(out, [written(rows[0]!), `| ${Array<string>(columns).fill('---').join(' | ')} |`, ...rows.slice(1).map(written)].join('\n'), walk);
}

function block(element: Element, walk: Walk, out: string[]) {
    const name = element.localName;
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
        const text = line(inline(element, walk));
        if (text) {
            walk.headings++;
            push(out, `${'#'.repeat(Number(heading[1]))} ${text}`, walk);
        }
        return;
    }
    switch (name) {
        case 'p': case 'summary': case 'dt': case 'caption': case 'legend': {
            const text = paragraph(inline(element, walk));
            push(out, name === 'dt' || name === 'summary' ? wrapped(text.replace(/\n/g, ' '), '**') : text, walk);
            return;
        }
        case 'hr':
            push(out, '---', walk);
            return;
        case 'ul': case 'ol': case 'menu':
            list(element, walk, out);
            return;
        case 'table':
            if (element instanceof HTMLTableElement) table(element, walk, out);
            return;
        case 'pre': {
            const code = (element.textContent ?? '').replace(/\n$/, '');
            if (!code.trim()) return;
            const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map(run => run.length));
            const fence = '`'.repeat(longest + 1);
            const language = /\blanguage-([\w-]+)/.exec(element.querySelector('code')?.className ?? '')?.[1] ?? '';
            push(out, `${fence}${language}\n${code.slice(0, markdownLimit)}\n${fence}`, walk);
            return;
        }
        case 'blockquote': {
            const content = children(element, walk).join('\n\n');
            if (content) out.push(content.split('\n').map(part => part ? `> ${part}` : '>').join('\n'));
            return;
        }
        case 'details': {
            const summary = [...element.children].find(child => child.localName === 'summary');
            if (!element.hasAttribute('open')) {
                // Closed: its summary shows, the rest is text the page hides right now
                if (summary && admit(summary, walk) !== 'skip') block(summary, walk, out);
                if (oneLine(element.textContent, 100_000).length - oneLine(summary?.textContent, 100_000).length >= hiddenTextMinimum) walk.hiddenBlocks++;
                return;
            }
            children(element, walk, out);
            return;
        }
        default:
            children(element, walk, out);
    }
}

// --- Choosing the main content

const words = (() => {
    let segmenter: Intl.Segmenter | undefined;
    return (text: string) => {
        try {
            segmenter ??= new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'word' });
            let found = 0;
            for (const segment of segmenter.segment(text)) if (segment.isWordLike) found++;
            return found;
        } catch {
            return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
        }
    };
})();

const pageElements = (selector: string) => [...document.querySelectorAll(selector)].filter(element => !isToolbarNode(element));

/** The page's main landmark, else its largest article, else its body (without chrome) */
function contentRoot(): { element: Element; root: ContentRoot } {
    const main = pageElements('main, [role="main"]').find(element => visibility(element) !== 'hidden');
    if (main) return { element: main, root: 'main' };
    const article = largestArticle();
    if (article) return { element: article.element, root: 'article' };
    return { element: document.body ?? document.documentElement, root: 'body' };
}

function largestArticle() {
    let largest: { element: Element; length: number } | undefined;
    for (const element of pageElements('article')) {
        const length = (element.textContent ?? '').trim().length;
        if (length && (!largest || length > largest.length) && visibility(element) !== 'hidden') largest = { element, length };
    }
    return largest;
}

/** An estimate: about four characters a token, one for each CJK character */
function tokens(markdown: string) {
    const cjk = markdown.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const estimate = Math.round((markdown.length - cjk) / 4 + cjk);
    // Two significant digits: it is an estimate
    const scale = 10 ** Math.max(0, String(estimate).length - 2);
    return Math.round(estimate / scale) * scale;
}

// --- Structured data (a small reader of its own: JSON-LD only)

type LdNode = Record<string, unknown>;

function readJsonLd(): LdNode[] {
    const nodes: LdNode[] = [];
    const collect = (value: unknown, depth: number) => {
        if (depth > 8 || nodes.length >= 300 || !value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 100)) collect(item, depth + 1);
            return;
        }
        const node = value as LdNode;
        if ('@type' in node) nodes.push(node);
        for (const [key, child] of Object.entries(node)) if (key !== '@context') collect(child, depth + 1);
    };
    for (const script of pageElements('script[type="application/ld+json" i]').slice(0, 20)) {
        const text = script.textContent ?? '';
        if (text.length > 200_000) continue;
        try { collect(JSON.parse(text), 0); } catch { /* Not JSON: nothing to read. */ }
    }
    return nodes;
}

/** `Article`, `schema:NewsArticle` and `https://schema.org/BlogPosting` alike */
const typesOf = (node: LdNode) => [node['@type']].flat().filter((type): type is string => typeof type === 'string').map(type => type.split(/[/:#]/).pop()!);
const isArticleType = (type: string) => /Article$/.test(type) || /^(BlogPosting|LiveBlogPosting|SocialMediaPosting|DiscussionForumPosting|Report)$/.test(type);

function ldReader(nodes: LdNode[]) {
    const byId = new Map<string, LdNode>();
    for (const node of nodes) if (typeof node['@id'] === 'string' && Object.keys(node).length > 1) byId.set(node['@id'], node);
    const names = (value: unknown, depth = 0): string[] => {
        if (depth > 3) return [];
        if (typeof value === 'string') return oneLine(value, 80) ? [oneLine(value, 80)] : [];
        if (Array.isArray(value)) return value.slice(0, 5).flatMap(item => names(item, depth + 1));
        if (!value || typeof value !== 'object') return [];
        const node = value as LdNode;
        const linked = typeof node['@id'] === 'string' && Object.keys(node).length === 1 ? byId.get(node['@id']) : undefined;
        if (linked) return names(linked, depth + 1);
        const name = typeof node.name === 'string' ? node.name
            : [node.givenName, node.familyName].filter(part => typeof part === 'string').join(' ');
        return oneLine(name, 80) ? [oneLine(name, 80)] : [];
    };
    const articles = nodes.filter(node => typesOf(node).some(isArticleType));
    /** The first value of a property, from an article first, then any node */
    const first = (key: string) => [...articles, ...nodes].find(node => node[key] !== undefined && node[key] !== '')?.[key];
    const text = (key: string) => {
        const value = first(key);
        return typeof value === 'string' ? oneLine(value, 60) : undefined;
    };
    const organization = nodes.find(node => typesOf(node).some(type => /Organization$|^Corporation$/.test(type)));
    const website = nodes.find(node => typesOf(node).includes('WebSite'));
    return {
        article: articles[0] && typesOf(articles[0]).find(isArticleType),
        authors: [...new Set(names(first('author')))].slice(0, 3),
        published: text('datePublished'),
        modified: text('dateModified'),
        publisher: names(first('publisher'))[0] ?? (organization && names(organization)[0]) ?? (website && names(website.publisher ?? website)[0])
    };
}

// --- Citable facts

/** A meta tag's content, by its `property` (Open Graph) or `name` */
const meta = (key: string) =>
    oneLine(document.querySelector(`meta[property="${key}" i], meta[name="${key}" i]`)?.getAttribute('content'), 80) || undefined;

/** A date as written (`2026-03-04`, `2026-03-04T10:00:00Z`), in milliseconds; anything else is no date */
function dateValue(value: string | undefined) {
    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
    const time = Date.parse(value.replace(' ', 'T'));
    return Number.isNaN(time) ? undefined : time;
}

const day = 24 * 60 * 60 * 1000;
const shortDate = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;

function listed(parts: string[]) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} ${lt().aiSearch.and} ${parts.at(-1)}`;
}

function facts(root: Element, path: string): PageCheck[] {
    const ld = ldReader(readJsonLd());
    const ogType = meta('og:type')?.toLowerCase();
    const article = largestArticle();
    const articleLength = article ? words(article.element.textContent ?? '') : 0;
    const { aiSearch: t, found } = lt();
    const why = ogType === 'article' ? t.ogArticle
        : ld.article ? t.ldArticle(oneLine(ld.article, 40))
            : articleLength >= articleWords ? t.articleElement(articleLength) : undefined;
    const articleLike = why !== undefined;
    // On a page that is not article-like, every row is a note
    const state = (found: boolean): CheckState => !articleLike ? 'none' : found ? 'pass' : 'warn';
    const issueAbout = (id: string, element: Element | undefined, summary: string, comment: string): PageIssue[] =>
        articleLike ? [pageIssue(path, { type: 'seo', id }, element, summary, comment)] : [];

    const type = pageCheck('ai-article', t.pageType, 'none', why ?? t.notArticleLike,
        { value: articleLike ? t.article : t.notArticle });

    // Who wrote it
    const pageAuthors: { source: string; name: string }[] = [];
    const metaAuthor = meta('author');
    if (metaAuthor) pageAuthors.push({ source: t.sources.authorMeta, name: metaAuthor });
    const relAuthor = pageElements('a[rel~="author" i], link[rel~="author" i]')[0];
    if (relAuthor) pageAuthors.push({ source: t.sources.relAuthor, name: relAuthor.localName === 'a' ? line(relAuthor.textContent ?? '') : '' });
    const itemAuthor = pageElements('[itemprop~="author"]')[0];
    if (itemAuthor) {
        const name = itemAuthor.querySelector('[itemprop~="name"]')?.textContent ?? (itemAuthor.localName === 'meta' ? itemAuthor.getAttribute('content') : itemAuthor.textContent);
        pageAuthors.push({ source: t.sources.itemprop, name: oneLine(name, 80) });
    }
    const authorSources = [...ld.authors.length ? [t.sources.structuredData] : [], ...pageAuthors.map(found => found.source)];
    const authorName = ld.authors.join(', ') || pageAuthors.find(found => found.name)?.name;
    const author = authorSources.length
        ? pageCheck('ai-author', t.author, state(true), t.namedIn(listed(authorSources)), { value: authorName || undefined })
        : pageCheck('ai-author', t.author, state(false), t.noAuthor, {
            issues: issueAbout('ai-author', undefined, t.noAuthorSummary, t.noAuthorComment)
        });

    // When
    const published = ld.published ?? meta('article:published_time');
    const modified = ld.modified ?? meta('article:modified_time');
    const times = pageElements('time[datetime]').filter(element => visibility(element) === 'visible');
    const shown = times.find(element => /\bdatePublished\b/.test(element.getAttribute('itemprop') ?? '') || element.hasAttribute('pubdate'))
        ?? times.find(element => root.contains(element)) ?? times[0];
    const shownValue = shown && oneLine(shown.getAttribute('datetime'), 40);
    const shownTime = dateValue(shownValue);
    const structured = [published, modified].filter((value): value is string => dateValue(value) !== undefined);
    const dateSources = [...ld.published || ld.modified ? [t.sources.structuredData] : [],
        ...!ld.published && !ld.modified && (published || modified) ? [t.sources.articleMeta] : [], ...shownValue ? [t.sources.time] : []];
    let dates: PageCheck;
    if (shownTime !== undefined && structured.length && structured.every(value => Math.abs(dateValue(value)! - shownTime) > day)) {
        const other = structured[0]!;
        const reason = t.datesApart;
        dates = pageCheck('ai-dates', t.dates, articleLike ? 'warn' : 'none', reason, {
            value: t.shownVersus(shortDate(shownValue!), shortDate(other)),
            issues: issueAbout('ai-dates', shown, reason,
                `SEO: ${reason}${foundLine(found.shown, `${line(shown!.textContent ?? '')} (${shownValue})`)}${foundLine(found.structuredData, other)}`)
        });
    } else if (dateSources.length) {
        const value = [published && t.published(shortDate(published)), modified && t.modified(shortDate(modified), !published)]
            .filter(Boolean).join(', ') || t.shownDate(shortDate(shownValue!));
        dates = pageCheck('ai-dates', t.dates, state(true), t.datesIn(listed(dateSources)), { value });
    } else {
        dates = pageCheck('ai-dates', t.dates, state(false), t.noDates, {
            issues: issueAbout('ai-dates', undefined, t.noDatesSummary, t.noDatesComment)
        });
    }

    // Who publishes it
    const siteName = meta('og:site_name');
    const publisher = ld.publisher
        ? pageCheck('ai-publisher', t.publisher, state(true), t.publisherLd, { value: ld.publisher })
        : siteName ? pageCheck('ai-publisher', t.publisher, state(true), t.publisherSite, { value: siteName })
            : pageCheck('ai-publisher', t.publisher, 'none', t.noPublisher);

    // What it cites
    const hosts = new Set<string>();
    let links = 0;
    for (const link of root.querySelectorAll('a[href]')) {
        let url: URL;
        try { url = new URL(link.getAttribute('href') ?? '', document.baseURI); } catch { continue; }
        if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin || isToolbarNode(link) || visibility(link) !== 'visible') continue;
        links++;
        hosts.add(url.hostname.replace(/^www\./, ''));
    }
    const sources = links
        ? pageCheck('ai-sources', t.sourcesLabel, state(true), t.links(links), { value: [...hosts].slice(0, 3).join(', ') + (hosts.size > 3 ? ', ...' : '') })
        : pageCheck('ai-sources', t.sourcesLabel, 'none', t.noLinks);

    return [type, author, dates, publisher, sources];
}

// --- The section

/** Reads the page now: its main content as Markdown, what the text leaves out, and its citable facts */
export function readPage({ path, signal }: SectionContext): AiSearchReport {
    signal.throwIfAborted();
    const { element, root } = contentRoot();
    const walk: Walk = { chars: 0, elements: 0, stopped: false, chrome: root === 'body', headings: 0, imagesWithoutAlt: 0, frames: 0, canvases: 0, hiddenBlocks: 0 };
    let markdown = children(element, walk).join('\n\n');
    const truncated = walk.stopped;
    if (markdown.length > markdownLimit) markdown = markdown.slice(0, markdownLimit).replace(/\n[^\n]*$/, '');
    const wordCount = words(markdown.replace(/\]\([^)]*\)/g, ']'));

    const t = lt().aiSearch;
    const where = t.where[root === 'main' ? 'main' : root === 'article' ? 'article' : 'body'];
    const content = root === 'main'
        ? pageCheck('ai-content', t.mainContent, 'pass', t.mainOk, { value: where })
        : pageCheck('ai-content', t.mainContent, 'warn', t.noMain(root === 'article'), {
            value: where,
            issues: [pageIssue(path, { type: 'seo', id: 'ai-content' }, undefined, t.noMainSummary, t.noMainComment)]
        });

    const text = pageCheck('ai-text', t.text, wordCount < littleText ? 'none' : 'pass',
        `${wordCount < littleText ? t.littleText : ''}${truncated ? t.cut(markdownLimit, elementLimit) : ''}${t.rendered}`, {
            value: t.wordsAndHeadings(wordCount, walk.headings),
            measure: t.tokens(tokens(markdown))
        });

    const outside = [
        walk.imagesWithoutAlt && t.imagesWithoutAlt(walk.imagesWithoutAlt),
        walk.frames && t.frames(walk.frames),
        walk.canvases && t.canvases(walk.canvases),
        walk.hiddenBlocks && t.hiddenBlocks(walk.hiddenBlocks)
    ].filter((part): part is string => Boolean(part));
    const leftOut = outside.length
        ? pageCheck('ai-left-out', t.notInText, 'none', t.leftOut, { value: listed(outside) })
        : pageCheck('ai-left-out', t.notInText, 'pass', t.nothingLeftOut);

    return {
        checks: [content, text, leftOut, ...facts(element, path)],
        details: {
            markdown, truncated, root,
            title: oneLine(document.title, 300),
            description: oneLine(document.querySelector('meta[name="description" i]')?.getAttribute('content'), 1000)
        }
    };
}
