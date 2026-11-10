// What the Crawlers section reads from a site's own files, as plain text in and plain data out: no
// DOM and no requests, so `apps/web/e2e/page-checks-crawler.api.spec.ts` imports it in Node.
// robots.txt follows RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309).

export type RobotsRule = { allow: boolean; pattern: string; line: number; text: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };
export type RobotsFile = { groups: RobotsGroup[]; sitemaps: string[] };

/** A group's product token: letters, `_` and `-` (RFC 9309, 2.2.1), lowercase; `*` for every other crawler */
function agentToken(value: string) {
    return value.startsWith('*') ? '*' : /^[a-z_-]+/i.exec(value)?.[0]?.toLowerCase();
}

/**
 * The groups of a robots.txt: user-agent lines in a row start a group (one after rules starts the
 * next), rules before any group are ignored, and `Sitemap` lines belong to no group. Other records
 * (Crawl-delay) neither start nor end a group. An empty `Allow:`/`Disallow:` is no rule, but still
 * ends the group's user-agent lines.
 */
export function parseRobots(text: string): RobotsFile {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let group: RobotsGroup | undefined;
    let agentsOpen = false;
    text.replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, index) => {
        const match = /^\s*([a-z-]+)\s*:\s*(.*)$/i.exec(raw.replace(/#.*/, ''));
        if (!match) return;
        const key = match[1]!.toLowerCase();
        const value = match[2]!.trim();
        if (key === 'user-agent') {
            const token = agentToken(value);
            if (!group || !agentsOpen) groups.push(group = { agents: [], rules: [] });
            agentsOpen = true;
            if (token) group.agents.push(token);
        } else if (key === 'allow' || key === 'disallow') {
            if (!group) return;
            agentsOpen = false;
            if (value) group.rules.push({ allow: key === 'allow', pattern: normalizePath(value), line: index + 1, text: `${key === 'allow' ? 'Allow' : 'Disallow'}: ${value}` });
        } else if (key === 'sitemap' && value) {
            sitemaps.push(value);
        }
    });
    return { groups, sitemaps };
}

/**
 * A path as RFC 9309 compares it (2.2.2): characters outside US-ASCII percent-encoded as UTF-8, the
 * escapes of unreserved characters decoded and the others in upper case
 */
export function normalizePath(value: string) {
    let encoded = '';
    for (const char of value) {
        const code = char.codePointAt(0)!;
        if (code > 0x20 && code < 0x7f) encoded += char;
        else {
            try { encoded += encodeURIComponent(char); } catch { /* A lone surrogate: left out. */ }
        }
    }
    return encoded.replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
        const char = String.fromCharCode(Number.parseInt(hex, 16));
        return /[A-Za-z0-9._~-]/.test(char) ? char : `%${hex.toUpperCase()}`;
    });
}

/**
 * Whether a rule's pattern matches a path from its start: `*` is any run of characters, a final `$`
 * the end of the path. Every position the pattern can have reached is tracked, so a pattern of many
 * `*` takes at most its length times the path's.
 */
export function patternMatches(pattern: string, path: string) {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    let positions = [0];
    for (const char of body) {
        if (char === '*') {
            const from = positions[0]!;
            positions = Array.from({ length: path.length - from + 1 }, (_, offset) => from + offset);
            continue;
        }
        const next: number[] = [];
        for (const position of positions) if (path[position] === char) next.push(position + 1);
        if (!next.length) return false;
        positions = next;
    }
    return !anchored || positions.at(-1) === path.length;
}

export type RobotsVerdict = {
    allowed: boolean;
    /** The rule that decided, when one matched */
    rule?: RobotsRule;
    /** The group's user-agent lines: the crawler's own (`googlebot`), or `*` when it has none */
    agents: string[];
};

/**
 * Whether a crawler (its product token) may read a path and query: its own groups (case-insensitive,
 * combined when there are several), else the `*` groups, else no rules. The longest matching pattern
 * wins, `Allow` on a tie (RFC 9309, 2.2.2); `/robots.txt` itself is always allowed.
 */
export function robotsVerdict(file: RobotsFile, token: string, path: string): RobotsVerdict {
    const own = file.groups.filter(group => group.agents.includes(token.toLowerCase()));
    const groups = own.length ? own : file.groups.filter(group => group.agents.includes('*'));
    const agents = own.length ? [token.toLowerCase()] : groups.length ? ['*'] : [];
    const target = normalizePath(path);
    if (target === '/robots.txt') return { allowed: true, agents };
    let decided: RobotsRule | undefined;
    for (const rule of groups.flatMap(group => group.rules)) {
        if (!patternMatches(rule.pattern, target)) continue;
        if (!decided || rule.pattern.length > decided.pattern.length || (rule.pattern.length === decided.pattern.length && rule.allow && !decided.allow)) decided = rule;
    }
    return { allowed: decided?.allow ?? true, rule: decided, agents };
}

/** What an AI crawler's requests are for, in the vendor's own terms */
export type AiCrawlerUse = 'training' | 'search' | 'user' | 'data';

/**
 * AI crawlers' robots.txt tokens, each checked against its vendor's documentation (the link beside
 * it). These change: check the links before adding or renaming one. Bytespider is left out: ByteDance
 * publishes no page that could be confirmed.
 */
export const aiCrawlers: readonly { token: string; by: string; use: AiCrawlerUse }[] = [
    // https://developers.openai.com/api/docs/bots
    { token: 'GPTBot', by: 'OpenAI', use: 'training' },
    { token: 'OAI-SearchBot', by: 'OpenAI', use: 'search' },
    { token: 'ChatGPT-User', by: 'OpenAI', use: 'user' },
    // https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
    { token: 'ClaudeBot', by: 'Anthropic', use: 'training' },
    { token: 'Claude-SearchBot', by: 'Anthropic', use: 'search' },
    { token: 'Claude-User', by: 'Anthropic', use: 'user' },
    // https://docs.perplexity.ai/guides/bots
    { token: 'PerplexityBot', by: 'Perplexity', use: 'search' },
    { token: 'Perplexity-User', by: 'Perplexity', use: 'user' },
    // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended (a token only: Google's crawlers read it)
    { token: 'Google-Extended', by: 'Google', use: 'training' },
    // https://support.apple.com/en-us/119829 (a token only: Applebot reads it)
    { token: 'Applebot-Extended', by: 'Apple', use: 'training' },
    // https://commoncrawl.org/ccbot (an open repository of web crawl data)
    { token: 'CCBot', by: 'Common Crawl', use: 'data' },
    // https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
    { token: 'meta-externalagent', by: 'Meta', use: 'training' },
    // https://developer.amazon.com/amazonbot
    { token: 'Amazonbot', by: 'Amazon', use: 'training' }
];

/** The robots.txt tokens of the search crawlers checked by name; every other crawler gets the `*` group */
export const searchCrawlers: readonly string[] = ['Googlebot', 'Bingbot'];

/** Directives of `X-Robots-Tag` that take a value after a colon, so `max-snippet: 20` names no crawler */
const valuedDirectives = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);

/**
 * An `X-Robots-Tag` value's directives by crawler: `*` for every crawler, else the name before a
 * colon (`googlebot: noindex`), which applies to the directives after it. Several headers arrive
 * joined with commas.
 */
export function robotsHeader(value: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();
    let agent = '*';
    for (const part of value.toLowerCase().split(',')) {
        let directive = part.trim();
        const scoped = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(directive);
        if (scoped && !valuedDirectives.has(scoped[1]!)) {
            agent = scoped[1]!;
            directive = scoped[2]!.trim();
        }
        if (directive) directives.set(agent, [...directives.get(agent) ?? [], directive]);
    }
    return directives;
}

/** Whether directives keep a page out of search results: `noindex`, or `none` (noindex, nofollow) */
export const keepsOut = (directives: readonly string[] | undefined) => Boolean(directives?.some(directive => directive === 'noindex' || directive === 'none'));

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function decodeEntities(text: string) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
        if (name[0] !== '#') return entities[name.toLowerCase()] ?? entity;
        const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        try { return String.fromCodePoint(code); } catch { return entity; }
    });
}

/**
 * The addresses of a sitemap: its `<loc>` elements (a `<sitemapindex>` lists more sitemaps), or a
 * text sitemap's lines. Read with a pattern, not an XML parser, so a file cut at the size limit still
 * gives what it has; `<image:loc>` and the like are not pages.
 */
export function sitemapEntries(text: string): { index: boolean; locations: string[] } {
    if (!text.includes('<')) {
        return { index: false, locations: text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line)) };
    }
    const locations: string[] = [];
    for (const match of text.matchAll(/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*?))\s*<\/loc>/gi)) {
        const location = (match[1] ?? decodeEntities(match[2] ?? '')).trim();
        if (location) locations.push(location);
    }
    return { index: /<sitemapindex[\s>]/i.test(text), locations };
}

/** The addresses an llms.txt links to: Markdown links and bare http(s) addresses (without a sentence's last stop) */
export function textLinks(text: string): string[] {
    const links = [...text.matchAll(/\]\(\s*<?([^\s)>]+)>?/g)].map(match => match[1]!);
    for (const match of text.matchAll(/https?:\/\/[^\s)>\]"'`]+/gi)) links.push(match[0].replace(/[.,;:!?]+$/, ''));
    return links;
}

/**
 * How much of a page's text is in other text (the HTML a server sends): the characters of the
 * page's words that the other text has too, each word counted as often as it appears there
 */
export function textShare(page: string, other: string): { share: number; characters: number; found: number } {
    const available = new Map<string, number>();
    for (const word of other.split(/\s+/)) if (word) available.set(word, (available.get(word) ?? 0) + 1);
    let characters = 0;
    let found = 0;
    for (const word of page.split(/\s+/)) {
        if (!word) continue;
        characters += word.length;
        const left = available.get(word) ?? 0;
        if (left) {
            found += word.length;
            available.set(word, left - 1);
        }
    }
    return { share: characters ? found / characters : 1, characters, found };
}

/** An address as the Crawlers section compares pages: its origin and path, without a trailing slash */
export function pageKey(address: string, base?: string): string | undefined {
    try {
        const url = new URL(address, base);
        if (!/^https?:$/.test(url.protocol)) return undefined;
        return `${url.origin}${url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : ''}`;
    } catch {
        return undefined;
    }
}
