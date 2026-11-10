import { elementKey, elementLabel, foundLine, oneLine, writtenAddress } from './pageElements';
import type { CheckState, PageCheck, PageIssue } from './types';

// The SEO panel's checks: what the page tells search engines, read from the page's own document
// (the toolbar's shadow root and inline threads are never in `document.querySelectorAll`).

export type HeadingEntry = { key: string; level: number; text: string; element: Element };

export type SeoReport = {
    path: string;
    checkedAt: number;
    page: PageCheck[];
    headings: { outline: HeadingEntry[]; checks: PageCheck[] };
    links: { total: number; internal: number; external: number; checks: PageCheck[] };
    images: { total: number; checks: PageCheck[] };
};

/** The page `checkSeo` is checking: issue keys end with it, so a comment posted on one page doesn't mark the same finding on another */
let checkedPath = '';

function issue(check: string, element: Element | undefined, summary: string, comment: string): PageIssue {
    return { key: `seo:${check}:${element ? elementKey(element) : 'page'}@${checkedPath}`, summary, comment, path: checkedPath, check: { type: 'seo', id: check }, element, label: element && elementLabel(element) };
}

/**
 * Whether every issue says the same thing. The panel then shows that line once, as the check's reason, so a
 * check whose generic reason doesn't already say it puts it there (`sharedSummary` in `ChecksParts.tsx`)
 */
function alike(issues: readonly PageIssue[]) {
    return issues.every(item => item.summary === issues[0]?.summary);
}

function check(id: string, label: string, state: CheckState, reason: string, value?: string, issues: PageIssue[] = []): PageCheck {
    return { id, label, state, reason, value, issues };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const characters = (text: string) => [...text].length;

function titleCheck(): PageCheck {
    const title = oneLine(document.title, 1000);
    const length = characters(title);
    if (!title) {
        return check('title', 'Title', 'warn', 'No title. Search results and browser tabs show one.', undefined,
            [issue('title', undefined, 'The page has no title.', 'SEO: The page has no title. Search results and browser tabs show one.')]);
    }
    if (length > 60) {
        return check('title', 'Title', 'warn', `${length} characters. Search results show about 60.`, title,
            [issue('title', undefined, 'The title is long.', `SEO: The page title is ${length} characters. Search results show about 60.${foundLine('Title', title)}`)]);
    }
    if (length < 10) {
        return check('title', 'Title', 'warn', `${count(length, 'character')}. Aim for 10 to 60.`, title,
            [issue('title', undefined, 'The title is short.', `SEO: The page title is ${count(length, 'character')}. A title of 10 to 60 characters describes the page better.${foundLine('Title', title)}`)]);
    }
    return check('title', 'Title', 'pass', `${length} characters, within 10 to 60.`, title);
}

function descriptionCheck(): PageCheck {
    const tags = [...document.querySelectorAll('meta[name="description" i]')];
    const text = oneLine(tags[0]?.getAttribute('content'), 1000);
    const length = characters(text);
    if (!text) {
        return check('description', 'Meta description', 'warn', 'No meta description. Search results may show any text from the page.', undefined,
            [issue('description', undefined, 'The page has no meta description.', 'SEO: The page has no meta description. Search results may show any text from the page.')]);
    }
    if (tags.length > 1) {
        return check('description', 'Meta description', 'warn', `${tags.length} description tags. Keep one.`, text,
            [issue('description', undefined, 'The page has more than one meta description.', `SEO: The page has ${tags.length} meta description tags. Keep one.${foundLine('First description', text)}`)]);
    }
    if (length > 160) {
        return check('description', 'Meta description', 'warn', `${length} characters. Search results show about 160.`, text,
            [issue('description', undefined, 'The description is long.', `SEO: The meta description is ${length} characters. Search results show about 160.${foundLine('Description', text)}`)]);
    }
    if (length < 50) {
        return check('description', 'Meta description', 'warn', `${count(length, 'character')}. Aim for 50 to 160.`, text,
            [issue('description', undefined, 'The description is short.', `SEO: The meta description is ${count(length, 'character')}. Aim for 50 to 160.${foundLine('Description', text)}`)]);
    }
    return check('description', 'Meta description', 'pass', `${length} characters, within 50 to 160.`, text);
}

/** A robots meta tag's directives, lowercase: `noindex, nofollow` is `['noindex', 'nofollow']` */
const directives = (tag: Element) => (tag.getAttribute('content') ?? '').toLowerCase().split(',').map(directive => directive.trim()).filter(Boolean);

/**
 * What the page's robots meta tags (`robots`, and `googlebot` for Google) ask of search engines.
 * `noindex` (or `none`) keeps the page out of search results, so it needs no canonical link. The
 * `X-Robots-Tag` response header is not in the document: the Crawlers section reads it from the
 * page's response (`lazy/crawler.ts`).
 */
function robotsCheck(): { check: PageCheck; noindex: boolean } {
    const tags = [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')];
    const blocking = tags.filter(tag => directives(tag).some(directive => directive === 'noindex' || directive === 'none'));
    const content = (list: Element[]) => oneLine(list.map(tag => directives(tag).join(', ')).filter(Boolean).join('; ')) || undefined;
    if (blocking.length) {
        const everyEngine = blocking.some(tag => tag.getAttribute('name')?.toLowerCase() === 'robots');
        return {
            noindex: true,
            check: check('robots', 'Indexing', 'none', `The page asks ${everyEngine ? 'search engines' : 'Google'} not to index it.`, content(blocking))
        };
    }
    return { noindex: false, check: check('robots', 'Indexing', 'pass', 'Search engines may index it.', content(tags)) };
}

const withoutTrailingSlash = (path: string) => path.length > 1 ? path.replace(/\/+$/, '') : path;

function canonicalCheck(noindex: boolean): PageCheck {
    const links = [...document.querySelectorAll('link[rel~="canonical" i]')];
    // A page kept out of search results has no main address to choose
    if (!links.length && noindex) return check('canonical', 'Canonical', 'none', 'Not needed on a noindex page.');
    if (!links.length) {
        return check('canonical', 'Canonical', 'warn', 'No canonical link. Search engines choose the main address on their own.', undefined,
            [issue('canonical', undefined, 'The page has no canonical link.', 'SEO: The page has no canonical link. Search engines choose the main address on their own.')]);
    }
    if (links.length > 1) {
        return check('canonical', 'Canonical', 'warn', `${links.length} canonical links. Search engines may ignore them all.`, undefined,
            [issue('canonical', undefined, 'The page has more than one canonical link.', `SEO: The page has ${links.length} canonical links. Search engines may ignore them all. Keep one.`)]);
    }
    const href = links[0]!.getAttribute('href')?.trim() ?? '';
    let target: URL | undefined;
    try { target = href ? new URL(href, document.baseURI) : undefined; } catch { /* Not valid: below. */ }
    if (!target || !/^https?:$/.test(target.protocol)) {
        return check('canonical', 'Canonical', 'warn', 'The canonical address is not valid.', oneLine(href) || undefined,
            [issue('canonical', undefined, 'The canonical address is not valid.', `SEO: The canonical address${href ? ` "${oneLine(href)}"` : ''} is not valid.`)]);
    }
    if (target.origin !== window.location.origin || withoutTrailingSlash(target.pathname) !== withoutTrailingSlash(window.location.pathname)) {
        return check('canonical', 'Canonical', 'warn', 'Points to another page. Search engines may show that one instead.', target.href,
            [issue('canonical', undefined, 'The canonical link points to another page.', `SEO: The canonical link points to another page, ${target.href}. Search engines may show that one instead.`)]);
    }
    return check('canonical', 'Canonical', 'pass', 'Points to this page.', target.href);
}

/**
 * The viewport meta tag (the last one counts): without `width=device-width` phones lay the page out
 * as wide as a desktop screen and show it zoomed out. Zoom blocking is the Accessibility panel's
 * (axe-core's `meta-viewport`).
 */
function viewportCheck(): PageCheck {
    const content = oneLine([...document.querySelectorAll('meta[name="viewport" i]')].at(-1)?.getAttribute('content'));
    if (/(?:^|[,;\s])width\s*=\s*device-width(?:$|[,;\s])/i.test(content)) return check('viewport', 'Viewport', 'pass', 'Fits the screen\'s width (width=device-width).', content);
    const reason = `${content ? 'No width=device-width in the viewport meta tag' : 'No viewport meta tag'}. Phones show the page zoomed out.`;
    return check('viewport', 'Viewport', 'warn', reason, content || undefined,
        [issue('viewport', undefined, reason, `SEO: ${reason} A tag such as \`<meta name="viewport" content="width=device-width, initial-scale=1">\` fits it to the screen.${foundLine('Viewport', content)}`)]);
}

/** The page's language (`html[lang]`): a note when missing. Whether its value is valid is the Accessibility panel's */
function languageCheck(): PageCheck {
    const lang = oneLine(document.documentElement.getAttribute('lang'), 40);
    return lang ? check('lang', 'Language', 'pass', 'The page says which language it is in.', lang)
        : check('lang', 'Language', 'none', 'No lang attribute on html. Screen readers and translation tools guess the language.', undefined,
            [issue('lang', undefined, 'The page does not say its language.', 'SEO: The page does not say its language: the html element has no lang attribute. Screen readers and translation tools then guess it.')]);
}

/** The text a heading or link is known by: its text, else its label or an image's alt text */
function accessibleText(element: Element) {
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
        .map(id => id && document.getElementById(id)?.textContent).join(' ');
    const image = element.querySelector('img[alt], [role="img"][aria-label], svg title');
    return oneLine(element.textContent) || oneLine(element.getAttribute('aria-label')) || oneLine(labelledBy)
        || oneLine(element.getAttribute('title')) || oneLine(image?.getAttribute('alt') ?? image?.getAttribute('aria-label') ?? image?.textContent)
        || (element instanceof HTMLAreaElement ? oneLine(element.alt) : '');
}

function headingChecks(): SeoReport['headings'] {
    const outline = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(element => ({
        key: `heading:${elementKey(element)}`, level: Number(element.tagName[1]), text: accessibleText(element), element
    }));
    const mains = outline.filter(heading => heading.level === 1);
    const main = !mains.length
        ? check('h1', 'Main heading', 'warn', 'No h1. Give the page one main heading.', undefined,
            [issue('h1', undefined, 'The page has no h1.', 'SEO: The page has no h1 heading. Give it one main heading.')])
        : mains.length > 1
            ? check('h1', 'Main heading', 'warn', `${mains.length} h1 headings. Keep one main heading.`, undefined,
                mains.slice(1).map(heading => issue('h1', heading.element, 'Another h1 on the page.', `SEO: This is another h1 on the page. Keep one main heading.${foundLine('Heading', heading.text)}`)))
            : check('h1', 'Main heading', 'pass', 'One h1.', mains[0]!.text || undefined);
    const skips = outline.flatMap((heading, index) => {
        const previous = outline[index - 1];
        return previous && heading.level > previous.level + 1
            ? [issue('levels', heading.element, `An h${heading.level} after an h${previous.level}.`, `SEO: This h${heading.level} comes after an h${previous.level}, skipping a level.${foundLine('Heading', heading.text)}`)]
            : [];
    });
    const levels = !outline.length ? check('levels', 'Heading levels', 'none', 'No headings.')
        // One skip says which (its row then shows only the heading); several say how many, and which when they are all alike
        : skips.length ? check('levels', 'Heading levels', 'warn', skips.length === 1 ? `${skips[0]!.summary.replace(/\.$/, '')}, skipping a level.`
            : `${count(skips.length, 'heading')} skip a level.${alike(skips) ? ` ${skips[0]!.summary}` : ''}`, undefined, skips)
            : check('levels', 'Heading levels', 'pass', 'No skipped levels.');
    const empty = outline.filter(heading => !heading.text)
        .map(heading => issue('empty-heading', heading.element, 'A heading without text.', `SEO: This heading has no text.${foundLine('Element', elementLabel(heading.element))}`));
    const text = !outline.length ? check('empty-heading', 'Heading text', 'none', 'No headings.')
        : empty.length ? check('empty-heading', 'Heading text', 'warn', `${count(empty.length, 'heading')} without text.`, undefined, empty)
            : check('empty-heading', 'Heading text', 'pass', 'Every heading has text.');
    return { outline, checks: [main, levels, text] };
}

/** Why a link's address looks broken, as a sentence, or nothing when it looks fine */
function brokenReason(link: HTMLAnchorElement | HTMLAreaElement): string | undefined {
    const raw = link.getAttribute('href') ?? '';
    const href = raw.trim();
    if (!href) return 'It has no address.';
    if (href === '#') return 'It points to "#" only.';
    if (/^javascript:/i.test(href)) return 'It runs a script instead of opening a page.';
    let url: URL;
    try { url = new URL(href, document.baseURI); } catch { return 'Its address is not valid.'; }
    const placeholder = /(?:^|[/=?&])(undefined|null|NaN)(?=$|[/?&#])/.exec(href)?.[1];
    if (placeholder) return `Its address contains "${placeholder}".`;
    if (window.location.protocol === 'https:' && url.protocol === 'http:') return 'It uses http on an https page.';
    const here = new URL(window.location.href);
    const fragment = url.hash.slice(1);
    if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search
        // Hash routes (#/page, #!/page) and #top are not elements
        && fragment && !/^[/!]/.test(fragment) && fragment.toLowerCase() !== 'top') {
        let id = fragment;
        try { id = decodeURIComponent(fragment); } catch { /* Kept as written. */ }
        if (!document.getElementById(id) && !document.getElementsByName(id).length) return `It points to #${oneLine(id, 40)}, which is not on this page.`;
    }
    return undefined;
}

/** Link text that says nothing out of context, in English: the whole text, lowercase, without trailing punctuation or arrows */
const genericPhrases = new Set(['click', 'click here', 'click this', 'tap here', 'here', 'right here', 'go', 'go here', 'this', 'this link',
    'this page', 'link', 'more', 'read more', 'learn more', 'see more', 'view more', 'find out more', 'more info', 'more information',
    'information', 'info', 'details', 'more details', 'see details', 'continue', 'continue reading', 'start']);
const genericText = (text: string) => {
    const phrase = text.toLowerCase().replace(/^[\s«‹←<]+|[\s.:!?…»›→>]+$/gu, '');
    return genericPhrases.has(phrase) ? phrase : undefined;
};

/**
 * Links whose whole text is a phrase that says nothing out of context ("read more", "click here").
 * The list is English: on a page in another language (`html[lang]`), not checked. A link with a label
 * of its own (`aria-label`, `aria-labelledby`) that is not generic is left out.
 */
function genericLinkCheck(links: (HTMLAnchorElement | HTMLAreaElement)[]): PageCheck {
    const lang = document.documentElement.lang.trim();
    if (lang && !/^en(?:-|$)/i.test(lang)) return check('link-generic', 'Generic link text', 'none', `Not checked: the phrases checked are English, and the page is in ${oneLine(lang, 20)}.`);
    const generic = links.flatMap(link => {
        const text = oneLine(link.textContent);
        const labelledBy = link.getAttribute('aria-labelledby')?.split(/\s+/).map(id => id && document.getElementById(id)?.textContent).join(' ');
        const label = oneLine(link.getAttribute('aria-label')) || oneLine(labelledBy);
        return text && genericText(text) && !(label && !genericText(label))
            ? [issue('link-generic', link, `Its text is only "${text}".`, `SEO: This link's whole text is a generic phrase. Out of context it does not say where the link goes.${foundLine('Link text', text)}${foundLine('Address', writtenAddress(link.getAttribute('href')))}`)]
            : [];
    });
    return !generic.length ? check('link-generic', 'Generic link text', 'pass', 'No link text like "read more" or "click here" alone.')
        : check('link-generic', 'Generic link text', 'warn', `${count(generic.length, 'link says', 'links say')} nothing out of context.${alike(generic) ? ` ${generic[0]!.summary}` : ''}`, undefined, generic);
}

function linkChecks(): SeoReport['links'] {
    const links = [...document.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]')];
    let internal = 0;
    let external = 0;
    for (const link of links) {
        try {
            const url = new URL(link.getAttribute('href') ?? '', document.baseURI);
            if (url.origin === window.location.origin) internal++;
            else if (/^https?:$/.test(url.protocol)) external++;
        } catch { /* Counted as neither. */ }
    }
    const textless = links.filter(link => !accessibleText(link))
        .map(link => issue('link-text', link, 'A link without text.', `SEO: This link has no text. Search engines and screen readers cannot tell where it goes.${foundLine('Address', writtenAddress(link.getAttribute('href')))}`));
    const broken = links.flatMap(link => {
        const reason = brokenReason(link);
        return reason ? [issue('link-address', link, reason, `SEO: This link looks broken. ${reason}${foundLine('Link text', accessibleText(link))}${foundLine('Address', writtenAddress(link.getAttribute('href')))}`)] : [];
    });
    return {
        total: links.length, internal, external,
        checks: !links.length ? [check('link-text', 'Links', 'none', 'No links on this page.')] : [
            textless.length ? check('link-text', 'Link text', 'warn', `${count(textless.length, 'link')} without text.`, undefined, textless)
                : check('link-text', 'Link text', 'pass', 'Every link has text.'),
            // Why goes in the reason when every link shares it, since the rows then show only the links
            broken.length ? check('link-address', 'Link addresses', 'warn', broken.length === 1 ? `1 link looks broken. ${broken[0]!.summary}`
                : `${count(broken.length, 'link')} look broken.${alike(broken) ? ` ${broken[0]!.summary}` : ''}`, undefined, broken)
                : check('link-address', 'Link addresses', 'pass', 'No broken-looking links.'),
            genericLinkCheck(links)
        ]
    };
}

/** Images that say nothing to search engines and screen readers: no `alt`, and not marked as decoration */
function imageChecks(): SeoReport['images'] {
    const images = [...document.querySelectorAll('img')];
    const missing = images.filter(image => !image.hasAttribute('alt') && !/^(presentation|none)$/.test(image.getAttribute('role') ?? '')
        && !image.closest('[aria-hidden="true"]'))
        .map(image => issue('alt', image, 'An image without alt text.', `SEO: This image has no alt text. Search engines and screen readers cannot tell what it shows.${foundLine('Image', writtenAddress(image.getAttribute('src') || image.currentSrc))}`));
    return {
        total: images.length,
        checks: [!images.length ? check('alt', 'Alt text', 'none', 'No images on this page.')
            : missing.length ? check('alt', 'Alt text', 'warn', `${count(missing.length, 'image')} without alt text.`, undefined, missing)
                : check('alt', 'Alt text', 'pass', 'Every image has alt text.')]
    };
}

/**
 * Reads the page now: its head (with the viewport and language), headings, links and images. More of
 * the Page, Links and Images sections run on demand in the audit asset (`lazy/pageExtras.ts`).
 */
export function checkSeo(path: string): SeoReport {
    checkedPath = path;
    const robots = robotsCheck();
    return {
        path,
        checkedAt: Date.now(),
        page: [robots.check, titleCheck(), descriptionCheck(), canonicalCheck(robots.noindex), viewportCheck(), languageCheck()],
        headings: headingChecks(),
        links: linkChecks(),
        images: imageChecks()
    };
}
