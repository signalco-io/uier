import { foundLine, isToolbarNode, oneLine } from '../pageElements';
import type { CheckState, PageCheck, PageIssue } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// Structured data: the page's JSON-LD (every `script[type="application/ld+json"]`), its parse errors,
// the types of its items and, for common types, the properties their documentation requires. Microdata
// and RDFa are counted, not checked (packages/toolbar/docs/page-checks-seo-head.md).

/**
 * The properties without which an item of a common type says little, as Google's documentation for
 * its search features lists them (checked in November 2026; they change, so each entry links its page).
 * Each entry of `properties` is one property, or several of which one is enough. `level`: `required`
 * (missing is worth a look) or `recommended` (a note; the documentation requires none). `parent`: only
 * for an item inside one of these types. Types not listed here are counted, never judged; schema.org
 * itself requires no property of any type.
 */
type Expectation = { properties: string[][]; level: 'required' | 'recommended'; feature: string; url: string; parent?: string[] };

const article: Expectation = {
    // "There are no required properties; instead, add the properties that apply to your content."
    properties: [['headline'], ['image'], ['datePublished'], ['author']], level: 'recommended',
    feature: 'article', url: 'https://developers.google.com/search/docs/appearance/structured-data/article'
};
const productUrl = 'https://developers.google.com/search/docs/appearance/structured-data/product-snippet';

const expectations: Record<string, Expectation> = {
    Article: article,
    NewsArticle: article,
    BlogPosting: article,
    // "Product snippets require either review or aggregateRating or offers"
    Product: { properties: [['name'], ['offers', 'review', 'aggregateRating']], level: 'required', feature: 'product snippet', url: productUrl },
    // An Offer's price, or its priceSpecification.price
    Offer: { properties: [['price', 'priceSpecification']], level: 'required', feature: 'product snippet', url: productUrl, parent: ['Product'] },
    BreadcrumbList: { properties: [['itemListElement']], level: 'required', feature: 'breadcrumb', url: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb' },
    Event: { properties: [['name'], ['startDate'], ['location']], level: 'required', feature: 'event', url: 'https://developers.google.com/search/docs/appearance/structured-data/event' },
    Recipe: { properties: [['name'], ['image']], level: 'required', feature: 'recipe', url: 'https://developers.google.com/search/docs/appearance/structured-data/recipe' },
    VideoObject: { properties: [['name'], ['thumbnailUrl'], ['uploadDate']], level: 'required', feature: 'video', url: 'https://developers.google.com/search/docs/appearance/structured-data/video' },
    LocalBusiness: { properties: [['name'], ['address']], level: 'required', feature: 'local business', url: 'https://developers.google.com/search/docs/appearance/structured-data/local-business' },
    WebSite: { properties: [['name'], ['url']], level: 'required', feature: 'site name', url: 'https://developers.google.com/search/docs/appearance/site-names' }
};

/** Bounds, so reading a page's data stays a few milliseconds of work (it runs in the background) */
const maxBlocks = 20;
const maxBlockLength = 100_000;
const maxTotalLength = 250_000;
const maxItems = 500;
const maxDepth = 16;

type Item = {
    block: number;
    types: string[];
    node: Record<string, unknown>;
    /** At the top of its block, or in its `@graph` */
    top: boolean;
    /** The types of the item it is in */
    parent?: string[];
};

/** `Article`, also when written as `https://schema.org/Article` or `schema:Article` */
const typesOf = (value: unknown) => (Array.isArray(value) ? value : [value])
    .filter((type): type is string => typeof type === 'string' && type.trim() !== '')
    .map(type => type.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, ''));

const schemaContext = (context: unknown): boolean => typeof context === 'string' ? /^https?:\/\/schema\.org\/?$/i.test(context.trim())
    : Array.isArray(context) ? context.some(schemaContext)
        : !!context && typeof context === 'object' && schemaContext((context as Record<string, unknown>)['@vocab']);

/** Every item (an object with `@type`) in a block, `@graph` flattened, nested items after their parent */
function collect(value: unknown, block: number, top: boolean, parent: string[] | undefined, items: Item[], depth = 0) {
    if (items.length >= maxItems || depth > maxDepth) return;
    if (Array.isArray(value)) {
        for (const entry of value) collect(entry, block, top, parent, items, depth + 1);
        return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const types = typesOf(node['@type']);
    if (types.length) items.push({ block, types, node, top, parent });
    if ('@graph' in node) collect(node['@graph'], block, top, parent, items, depth + 1);
    for (const [key, child] of Object.entries(node)) {
        if (!key.startsWith('@') && child && typeof child === 'object') collect(child, block, false, types.length ? types : parent, items, depth + 1);
    }
}

const present = (value: unknown) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);

const orList = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} ${words().structuredData.or} ${names.at(-1)}` : names[0] ?? '';
const andList = (parts: string[]) => parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${words().structuredData.and} ${parts.at(-1)}` : parts[0] ?? '';

/** What an item is known by in the panel and in a comment: its name or headline */
const itemName = (node: Record<string, unknown>) => {
    const name = [node.name, node.headline].find(value => typeof value === 'string');
    return typeof name === 'string' ? oneLine(name, 80) : '';
};

/** Where an item is: "Block 2", "Block 2, under Product" */
const where = (item: Item) => `${words().structuredData.block(item.block)}${item.parent ? words().structuredData.under(item.parent[0]!) : ''}`;

/** The properties an item lacks, as written in a sentence: "no name and no offers, review or aggregateRating" */
const lacking = (missing: string[][]) => andList(missing.map(names => words().structuredData.no(orList(names))));

/** "Google's product snippet documentation requires it", "... one of them", "... them" */
function rule(expectation: Expectation, missing: string[][]) {
    const what = missing.length > 1 ? 'them' : missing[0]!.length > 1 ? 'one' : 'it';
    return words().structuredData.rule(expectation.feature, expectation.level === 'required', what);
}

/** One row per judged type: its items, and what those lack */
function typeCheck(type: string, expectation: Expectation, items: Item[], path: string): PageCheck {
    const lacks = items.map(item => ({ item, missing: expectation.properties.filter(names => !names.some(name => present(item.node[name]))) }))
        .filter(({ missing }) => missing.length);
    const t = words().structuredData;
    const required = expectation.level === 'required';
    const measure = items.length > 1 ? t.items(items.length) : undefined;
    const value = items.length === 1 ? itemName(items[0]!.node) || undefined : undefined;
    const id = `schema-${type.toLowerCase()}`;
    if (!lacks.length) return pageCheck(id, type, 'pass', t.hasWhat(expectation.feature, required), { measure, value });
    const issues: PageIssue[] = required ? lacks.map(({ item, missing }) => pageIssue(path, { type: 'seo', id: `${id}-${item.block}-${items.indexOf(item) + 1}` }, undefined,
        t.lackSummary(where(item), itemName(item.node), lacking(missing)),
        `${t.lackComment(type, item.block, item.parent ? t.under(item.parent[0]!) : '', lacking(missing), rule(expectation, missing), expectation.url)}${foundLine(words().found.name, itemName(item.node))}`)) : [];
    const state: CheckState = required ? 'warn' : 'none';
    if (lacks.length === 1 && items.length === 1) {
        const [{ item, missing }] = lacks as [typeof lacks[number]];
        return pageCheck(id, type, state, t.oneLacks(where(item), lacking(missing), rule(expectation, missing)), { measure, value, issues });
    }
    return pageCheck(id, type, state, t.manyLack(lacks.length, t.items(items.length), expectation.feature, required), {
        measure, issues,
        // Notes have no issues: what each lacks is said here
        value: required ? undefined : oneLine(lacks.map(({ item, missing }) => `${where(item)}: ${andList(missing.map(orList))}`).join('; '), 300)
    });
}

/** Microdata items (`[itemscope]`) and RDFa elements (`[typeof]`), counted with their types */
function otherSyntaxes() {
    const pageOnly = (selector: string) => [...document.querySelectorAll(selector)].filter(element => !isToolbarNode(element));
    const names = (elements: Element[], attribute: string) => [...new Set(elements.flatMap(element =>
        (element.getAttribute(attribute) ?? '').trim().split(/\s+/).filter(Boolean).map(type => type.replace(/^.*[/#:]/, ''))))];
    const microdata = pageOnly('[itemscope]');
    const rdfa = pageOnly('[typeof]');
    return { microdata: microdata.length, rdfa: rdfa.length, types: [...new Set([...names(microdata, 'itemtype'), ...names(rdfa, 'typeof')])] };
}

/**
 * Reads the page's structured data now. Bounded (at most 20 blocks of up to 100,000 characters,
 * 250,000 in all, and 500 items), so it is a few milliseconds of work and runs in the background.
 * JSON-LD is not rendered: its issues are about the page and name the block by its position.
 */
export function checkStructuredData(context: SectionContext): SectionReport {
    const { path } = context;
    const scripts = [...document.querySelectorAll('script[type="application/ld+json" i]')].filter(script => !isToolbarNode(script));
    const errors: PageIssue[] = [];
    /** Each invalid block with the browser's message, for the check's line when it is one */
    const errorMessages: [number, string][] = [];
    const contexts: number[] = [];
    const items: Item[] = [];
    let skipped = 0;
    let total = 0;
    let blocks = 0;
    scripts.slice(0, maxBlocks).forEach((script, index) => {
        const block = index + 1;
        const text = script.textContent ?? '';
        if (!text.trim()) return;
        blocks++;
        if (text.length > maxBlockLength || total + text.length > maxTotalLength) {
            skipped++;
            return;
        }
        total += text.length;
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch (error) {
            const message = oneLine(error instanceof Error ? error.message : String(error), 160);
            errors.push(pageIssue(path, { type: 'seo', id: `schema-parse-${block}` }, undefined, words().structuredData.parseSummary(block, message),
                `${words().structuredData.parseComment(block)}${foundLine(words().found.error, message)}`));
            errorMessages.push([block, message]);
            return;
        }
        const roots = Array.isArray(data) ? data : [data];
        if (!roots.every(root => root && typeof root === 'object' && schemaContext((root as Record<string, unknown>)['@context']))) contexts.push(block);
        collect(data, block, true, undefined, items);
    });

    const t = words().structuredData;
    const top = items.filter(item => item.top);
    const types = [...new Set(top.flatMap(item => item.types))];
    const limits = [
        scripts.length > maxBlocks ? t.firstBlocks(maxBlocks) : '',
        skipped ? t.tooLarge(skipped) : '',
        items.length >= maxItems ? t.firstItems(maxItems) : ''
    ].filter(Boolean).join(' ');
    const other = otherSyntaxes();
    const checks: PageCheck[] = [];

    if (!blocks) {
        checks.push(pageCheck('schema-found', t.found, 'none', other.microdata || other.rdfa ? t.noJsonLd : t.none));
    } else {
        checks.push(top.length
            ? pageCheck('schema-found', t.found, 'pass', `${t.itemsIn(top.length, blocks)}${limits ? ` ${limits}` : ''}`, { value: oneLine(types.join(', '), 300) })
            : pageCheck('schema-found', t.found, 'none', `${t.noItems(blocks)}${limits ? ` ${limits}` : ''}`));
        checks.push(!errors.length ? pageCheck('schema-parse', t.parseErrors, 'pass', t.allValid)
            : pageCheck('schema-parse', t.parseErrors, 'warn', errors.length === 1 ? t.oneInvalid(...errorMessages[0]!)
                : t.manyInvalid(errors.length), { issues: errors }));
        if (contexts.length) {
            checks.push(pageCheck('schema-context', t.vocabulary, 'warn', t.noContext(contexts.length === 1 ? String(contexts[0]) : andList(contexts.map(String)), contexts.length === 1), {
                issues: contexts.map(block => pageIssue(path, { type: 'seo', id: `schema-context-${block}` }, undefined, t.noContextSummary(block),
                    t.noContextComment(block)))
            }));
        }
        // The common types, in the order the page has them
        const judged = new Map<string, Item[]>();
        for (const item of items) {
            const type = item.types.find(name => expectations[name] && (!expectations[name].parent || expectations[name].parent.some(parent => item.parent?.includes(parent))));
            if (type) judged.set(type, [...judged.get(type) ?? [], item]);
        }
        for (const [type, list] of judged) checks.push(typeCheck(type, expectations[type]!, list, path));
    }
    if (other.microdata || other.rdfa) {
        checks.push(pageCheck('schema-microdata', t.otherSyntaxes, 'none',
            t.counted(andList([other.microdata ? t.microdata(other.microdata) : '', other.rdfa ? t.rdfa(other.rdfa) : ''].filter(Boolean))),
            { value: oneLine(other.types.join(', '), 300) || undefined }));
    }
    return { checks, count: top.length || undefined };
}
