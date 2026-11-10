import { expect, test } from '@playwright/test';
import {
    aiCrawlers, keepsOut, normalizePath, pageKey, parseRobots, patternMatches, robotsHeader, robotsVerdict, sitemapEntries, textLinks, textShare
} from '../../../packages/toolbar/src/checks/lazy/crawlerRules';

// The rules the SEO panel's Crawlers section reads a site's files with (packages/toolbar/docs/page-checks-crawler.md):
// robots.txt per RFC 9309, X-Robots-Tag, sitemaps, llms.txt links and the served text's share.

const robots = parseRobots(`﻿# Rules before any user-agent line belong to no group
Disallow: /everything

User-agent: *
Disallow: /private
Allow: /private/open
Disallow: /*.pdf$
Disallow: /*?session=
Disallow: /shop
Allow: /shop

User-agent: Googlebot/2.1 # a version after the product token
User-agent: BINGBOT
Crawl-delay: 2
Disallow: /drafts
Disallow: /caf%c3%a9
Disallow: /~user

User-agent: googlebot
Disallow: /archive

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow:

Sitemap: https://site.example/sitemap.xml
Sitemap: https://cdn.example/other.xml
`);

/** Crawler, path and query, allowed, the rule that decided */
const cases: [string, string, boolean, string?][] = [
    // `*` for crawlers without a group of their own; the longest match wins
    ['OtherBot', '/', true],
    ['OtherBot', '/private', false, 'Disallow: /private'],
    ['OtherBot', '/private/open/page', true, 'Allow: /private/open'],
    ['OtherBot', '/privateer', false, 'Disallow: /private'],
    // `*` matches any characters, a final `$` the end of the path
    ['OtherBot', '/files/plan.pdf', false, 'Disallow: /*.pdf$'],
    ['OtherBot', '/files/plan.pdf?page=2', true],
    ['OtherBot', '/files/plan.pdfs', true],
    // The query is part of the path
    ['OtherBot', '/cart?session=12', false, 'Disallow: /*?session='],
    ['OtherBot', '/cart?page=2', true],
    // Allow wins a tie
    ['OtherBot', '/shop/item', true, 'Allow: /shop'],
    // Groups are found case-insensitively by product token, combined, and replace `*`
    ['Googlebot', '/drafts/one', false, 'Disallow: /drafts'],
    ['googlebot', '/archive/2024', false, 'Disallow: /archive'],
    ['Googlebot', '/private', true],
    ['Bingbot', '/drafts', false, 'Disallow: /drafts'],
    ['Bingbot', '/archive', true],
    // Percent-encoding: non-ASCII as UTF-8, unreserved escapes decoded, hex in upper case
    ['Googlebot', '/caf%C3%A9/menu', false, 'Disallow: /caf%c3%a9'],
    ['Googlebot', `/${encodeURI('café')}`, false, 'Disallow: /caf%c3%a9'],
    ['Googlebot', '/%7Euser/page', false, 'Disallow: /~user'],
    // Disallow: / blocks everything but robots.txt; an empty Disallow allows everything
    ['GPTBot', '/', false, 'Disallow: /'],
    ['gptbot', '/any/page', false, 'Disallow: /'],
    ['GPTBot', '/robots.txt', true],
    ['ClaudeBot', '/private', true],
    // Rules before the first user-agent line are ignored
    ['OtherBot', '/everything', true]
];

test('robots.txt groups, rules and sitemaps follow RFC 9309', () => {
    expect(robots.sitemaps).toEqual(['https://site.example/sitemap.xml', 'https://cdn.example/other.xml']);
    expect(robots.groups.map(group => group.agents)).toEqual([['*'], ['googlebot', 'bingbot'], ['googlebot'], ['gptbot'], ['claudebot']]);
    for (const [agent, path, allowed, rule] of cases) {
        const verdict = robotsVerdict(robots, agent, path);
        expect.soft(verdict.allowed, `${agent} ${path}`).toBe(allowed);
        expect.soft(verdict.rule?.text, `${agent} ${path}`).toBe(rule);
    }
    // The group that applied, and the rule's line for the comment
    expect(robotsVerdict(robots, 'OtherBot', '/private').agents).toEqual(['*']);
    expect(robotsVerdict(robots, 'Googlebot', '/drafts').agents).toEqual(['googlebot']);
    expect(robotsVerdict(robots, 'GPTBot', '/').rule?.line).toBe(23);
    // Without groups, every crawler may read every page
    expect(robotsVerdict(parseRobots('Sitemap: /sitemap.xml\n'), 'Googlebot', '/private')).toEqual({ allowed: true, rule: undefined, agents: [] });
    expect(robotsVerdict(parseRobots('<!doctype html><html><body>Not found</body></html>'), 'Googlebot', '/')).toMatchObject({ allowed: true });
});

test('robots.txt patterns match from the start of the path, in linear steps', () => {
    expect(patternMatches('/a', '/a/b')).toBe(true);
    expect(patternMatches('/b', '/a/b')).toBe(false);
    expect(patternMatches('/a$', '/a')).toBe(true);
    expect(patternMatches('/a$', '/a/')).toBe(false);
    expect(patternMatches('*', '/anything')).toBe(true);
    expect(patternMatches('/*/drafts', '/abc/drafts/one')).toBe(true);
    expect(patternMatches('/*/drafts/published$', '/abc/drafts/published')).toBe(true);
    expect(patternMatches('/*/drafts/published$', '/abc/drafts/published/2')).toBe(false);
    // A `$` before the end is a character
    expect(patternMatches('/a$b', '/a$b')).toBe(true);
    // Many stars over a long path stay fast
    const started = performance.now();
    expect(patternMatches(`/${'*a'.repeat(200)}b$`, `/${'a'.repeat(2000)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
    expect(normalizePath('/café/%7e%2f%41')).toBe('/caf%C3%A9/~%2FA');
});

test('X-Robots-Tag directives are read per crawler', () => {
    expect([...robotsHeader('noindex')]).toEqual([['*', ['noindex']]]);
    expect([...robotsHeader('googlebot: noindex, nofollow')]).toEqual([['googlebot', ['noindex', 'nofollow']]]);
    expect([...robotsHeader('max-snippet: 20, noarchive')]).toEqual([['*', ['max-snippet: 20', 'noarchive']]]);
    expect([...robotsHeader('unavailable_after: 2027-01-01, otherbot: none')]).toEqual([['*', ['unavailable_after: 2027-01-01']], ['otherbot', ['none']]]);
    expect(keepsOut(robotsHeader('None').get('*'))).toBe(true);
    expect(keepsOut(robotsHeader('nofollow').get('*'))).toBe(false);
});

test('sitemaps, llms.txt links, the served text and page addresses', () => {
    expect(sitemapEntries(`<?xml version="1.0"?><sitemapindex><sitemap><loc> https://site.example/a.xml </loc></sitemap></sitemapindex>`))
        .toEqual({ index: true, locations: ['https://site.example/a.xml'] });
    expect(sitemapEntries(`<urlset><url><loc>https://site.example/?a=1&amp;b=2</loc><image:image><image:loc>https://site.example/i.png</image:loc></image:image></url>
        <url><loc><![CDATA[https://site.example/b&c]]></loc></url><url><loc>https://site.example/d`))
        .toEqual({ index: false, locations: ['https://site.example/?a=1&b=2', 'https://site.example/b&c'] });
    expect(sitemapEntries('https://site.example/one\nnot an address\r\nhttps://site.example/two\n')).toEqual({ index: false, locations: ['https://site.example/one', 'https://site.example/two'] });
    expect(textLinks('# Site\n- [Plans](/plans): all plans\n- [Docs](<https://site.example/docs> "Docs")\nSee https://site.example/blog.')).toEqual(['/plans', 'https://site.example/docs', 'https://site.example/docs', 'https://site.example/blog']);
    expect(textShare('one two two three', 'two one four')).toEqual({ share: 6 / 14, characters: 14, found: 6 });
    expect(textShare('', 'anything').share).toBe(1);
    expect(pageKey('https://site.example/plans/')).toBe('https://site.example/plans');
    expect(pageKey('/plans?x=1#top', 'https://Site.example/a')).toBe('https://site.example/plans');
    expect(pageKey('https://site.example/')).toBe('https://site.example');
    expect(pageKey('mailto:team@site.example')).toBeUndefined();
});

test('every AI crawler has a vendor and a use', () => {
    expect(new Set(aiCrawlers.map(crawler => crawler.token.toLowerCase())).size).toBe(aiCrawlers.length);
    for (const crawler of aiCrawlers) expect(crawler.token).toMatch(/^[A-Za-z_-]+$/);
});
