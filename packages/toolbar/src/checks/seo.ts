import { elementKey, elementLabel, foundLine, oneLine, writtenAddress } from './pageElements';
import type { CheckState, PageCheck, PageIssue } from './types';
import { messages } from '../i18n';

// In the toolbar's language (`messages().seo`), read at check time: the panel's words and the comments
// its issues post (docs/localization.md). Check ids, states and issue keys stay the same in every language.

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

const characters = (text: string) => [...text].length;

function titleCheck(): PageCheck {
    const { seo: t, found } = messages();
    const title = oneLine(document.title, 1000);
    const length = characters(title);
    const label = t.labels.title;
    if (!title) {
        return check('title', label, 'warn', t.noTitle, undefined,
            [issue('title', undefined, t.noTitleSummary, t.comments.noTitle)]);
    }
    if (length > 60) {
        return check('title', label, 'warn', t.titleLong(length), title,
            [issue('title', undefined, t.titleLongSummary, `${t.comments.titleLong(length)}${foundLine(found.title, title)}`)]);
    }
    if (length < 10) {
        return check('title', label, 'warn', t.titleShort(t.characters(length)), title,
            [issue('title', undefined, t.titleShortSummary, `${t.comments.titleShort(t.characters(length))}${foundLine(found.title, title)}`)]);
    }
    return check('title', label, 'pass', t.titleOk(length), title);
}

function descriptionCheck(): PageCheck {
    const { seo: t, found } = messages();
    const tags = [...document.querySelectorAll('meta[name="description" i]')];
    const text = oneLine(tags[0]?.getAttribute('content'), 1000);
    const length = characters(text);
    const label = t.labels.description;
    if (!text) {
        return check('description', label, 'warn', t.noDescription, undefined,
            [issue('description', undefined, t.noDescriptionSummary, t.comments.noDescription)]);
    }
    if (tags.length > 1) {
        return check('description', label, 'warn', t.descriptionTags(tags.length), text,
            [issue('description', undefined, t.descriptionTagsSummary, `${t.comments.descriptionTags(tags.length)}${foundLine(found.firstDescription, text)}`)]);
    }
    if (length > 160) {
        return check('description', label, 'warn', t.descriptionLong(length), text,
            [issue('description', undefined, t.descriptionLongSummary, `${t.comments.descriptionLong(length)}${foundLine(found.description, text)}`)]);
    }
    if (length < 50) {
        return check('description', label, 'warn', t.descriptionShort(t.characters(length)), text,
            [issue('description', undefined, t.descriptionShortSummary, `${t.comments.descriptionShort(t.characters(length))}${foundLine(found.description, text)}`)]);
    }
    return check('description', label, 'pass', t.descriptionOk(length), text);
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
    const t = messages().seo;
    const tags = [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')];
    const blocking = tags.filter(tag => directives(tag).some(directive => directive === 'noindex' || directive === 'none'));
    const content = (list: Element[]) => oneLine(list.map(tag => directives(tag).join(', ')).filter(Boolean).join('; ')) || undefined;
    if (blocking.length) {
        const everyEngine = blocking.some(tag => tag.getAttribute('name')?.toLowerCase() === 'robots');
        return {
            noindex: true,
            check: check('robots', t.labels.robots, 'none', t.noindex(everyEngine), content(blocking))
        };
    }
    return { noindex: false, check: check('robots', t.labels.robots, 'pass', t.indexable, content(tags)) };
}

const withoutTrailingSlash = (path: string) => path.length > 1 ? path.replace(/\/+$/, '') : path;

function canonicalCheck(noindex: boolean): PageCheck {
    const t = messages().seo;
    const label = t.labels.canonical;
    const links = [...document.querySelectorAll('link[rel~="canonical" i]')];
    // A page kept out of search results has no main address to choose
    if (!links.length && noindex) return check('canonical', label, 'none', t.canonicalNotNeeded);
    if (!links.length) {
        return check('canonical', label, 'warn', t.noCanonical, undefined,
            [issue('canonical', undefined, t.noCanonicalSummary, t.comments.noCanonical)]);
    }
    if (links.length > 1) {
        return check('canonical', label, 'warn', t.canonicals(links.length), undefined,
            [issue('canonical', undefined, t.canonicalsSummary, t.comments.canonicals(links.length))]);
    }
    const href = links[0]!.getAttribute('href')?.trim() ?? '';
    let target: URL | undefined;
    try { target = href ? new URL(href, document.baseURI) : undefined; } catch { /* Not valid: below. */ }
    if (!target || !/^https?:$/.test(target.protocol)) {
        return check('canonical', label, 'warn', t.canonicalInvalid, oneLine(href) || undefined,
            [issue('canonical', undefined, t.canonicalInvalid, t.comments.canonicalInvalid(href ? oneLine(href) : ''))]);
    }
    if (target.origin !== window.location.origin || withoutTrailingSlash(target.pathname) !== withoutTrailingSlash(window.location.pathname)) {
        return check('canonical', label, 'warn', t.canonicalOther, target.href,
            [issue('canonical', undefined, t.canonicalOtherSummary, t.comments.canonicalOther(target.href))]);
    }
    return check('canonical', label, 'pass', t.canonicalOk, target.href);
}

/**
 * The viewport meta tag (the last one counts): without `width=device-width` phones lay the page out
 * as wide as a desktop screen and show it zoomed out. Zoom blocking is the Accessibility panel's
 * (axe-core's `meta-viewport`).
 */
function viewportCheck(): PageCheck {
    const { seo: t, found } = messages();
    const content = oneLine([...document.querySelectorAll('meta[name="viewport" i]')].at(-1)?.getAttribute('content'));
    if (/(?:^|[,;\s])width\s*=\s*device-width(?:$|[,;\s])/i.test(content)) return check('viewport', t.labels.viewport, 'pass', t.viewportOk, content);
    const reason = content ? t.viewportNoWidth : t.viewportMissing;
    return check('viewport', t.labels.viewport, 'warn', reason, content || undefined,
        [issue('viewport', undefined, reason, `${t.comments.viewport(reason)}${foundLine(found.viewport, content)}`)]);
}

/** The page's language (`html[lang]`): a note when missing. Whether its value is valid is the Accessibility panel's */
function languageCheck(): PageCheck {
    const t = messages().seo;
    const lang = oneLine(document.documentElement.getAttribute('lang'), 40);
    return lang ? check('lang', t.labels.lang, 'pass', t.langOk, lang)
        : check('lang', t.labels.lang, 'none', t.langMissing, undefined,
            [issue('lang', undefined, t.langMissingSummary, t.comments.noLang)]);
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
    const { seo: t, found } = messages();
    const outline = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(element => ({
        key: `heading:${elementKey(element)}`, level: Number(element.tagName[1]), text: accessibleText(element), element
    }));
    const mains = outline.filter(heading => heading.level === 1);
    const main = !mains.length
        ? check('h1', t.labels.h1, 'warn', t.noH1, undefined,
            [issue('h1', undefined, t.noH1Summary, t.comments.noH1)])
        : mains.length > 1
            ? check('h1', t.labels.h1, 'warn', t.h1s(mains.length), undefined,
                mains.slice(1).map(heading => issue('h1', heading.element, t.anotherH1, `${t.comments.anotherH1}${foundLine(found.heading, heading.text)}`)))
            : check('h1', t.labels.h1, 'pass', t.oneH1, mains[0]!.text || undefined);
    const skips = outline.flatMap((heading, index) => {
        const previous = outline[index - 1];
        return previous && heading.level > previous.level + 1
            ? [issue('levels', heading.element, t.skipSummary(heading.level, previous.level), `${t.comments.skip(heading.level, previous.level)}${foundLine(found.heading, heading.text)}`)]
            : [];
    });
    const firstSkip = outline.findIndex((heading, index) => index > 0 && heading.level > outline[index - 1]!.level + 1);
    const levels = !outline.length ? check('levels', t.labels.levels, 'none', t.noHeadings)
        // One skip says which (its row then shows only the heading); several say how many, and which when they are all alike
        : skips.length ? check('levels', t.labels.levels, 'warn', skips.length === 1 ? t.skipOne(outline[firstSkip]!.level, outline[firstSkip - 1]!.level)
            : `${t.skips(skips.length)}${alike(skips) ? ` ${skips[0]!.summary}` : ''}`, undefined, skips)
            : check('levels', t.labels.levels, 'pass', t.noSkips);
    const empty = outline.filter(heading => !heading.text)
        .map(heading => issue('empty-heading', heading.element, t.emptyHeadingSummary, `${t.comments.emptyHeading}${foundLine(found.element, elementLabel(heading.element))}`));
    const text = !outline.length ? check('empty-heading', t.labels.emptyHeading, 'none', t.noHeadings)
        : empty.length ? check('empty-heading', t.labels.emptyHeading, 'warn', t.emptyHeadings(empty.length), undefined, empty)
            : check('empty-heading', t.labels.emptyHeading, 'pass', t.headingsOk);
    return { outline, checks: [main, levels, text] };
}

/** Why a link's address looks broken, as a sentence, or nothing when it looks fine */
function brokenReason(link: HTMLAnchorElement | HTMLAreaElement, t: ReturnType<typeof messages>['seo']['broken']): string | undefined {
    const raw = link.getAttribute('href') ?? '';
    const href = raw.trim();
    if (!href) return t.none;
    if (href === '#') return t.hash;
    if (/^javascript:/i.test(href)) return t.script;
    let url: URL;
    try { url = new URL(href, document.baseURI); } catch { return t.invalid; }
    const placeholder = /(?:^|[/=?&])(undefined|null|NaN)(?=$|[/?&#])/.exec(href)?.[1];
    if (placeholder) return t.placeholder(placeholder);
    if (window.location.protocol === 'https:' && url.protocol === 'http:') return t.http;
    const here = new URL(window.location.href);
    const fragment = url.hash.slice(1);
    if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search
        // Hash routes (#/page, #!/page) and #top are not elements
        && fragment && !/^[/!]/.test(fragment) && fragment.toLowerCase() !== 'top') {
        let id = fragment;
        try { id = decodeURIComponent(fragment); } catch { /* Kept as written. */ }
        if (!document.getElementById(id) && !document.getElementsByName(id).length) return t.missingTarget(oneLine(id, 40));
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
    const { seo: t, found } = messages();
    const lang = document.documentElement.lang.trim();
    if (lang && !/^en(?:-|$)/i.test(lang)) return check('link-generic', t.labels.linkGeneric, 'none', t.genericNotChecked(oneLine(lang, 20)));
    const generic = links.flatMap(link => {
        const text = oneLine(link.textContent);
        const labelledBy = link.getAttribute('aria-labelledby')?.split(/\s+/).map(id => id && document.getElementById(id)?.textContent).join(' ');
        const label = oneLine(link.getAttribute('aria-label')) || oneLine(labelledBy);
        return text && genericText(text) && !(label && !genericText(label))
            ? [issue('link-generic', link, t.genericSummary(text), `${t.comments.generic}${foundLine(found.linkText, text)}${foundLine(found.address, writtenAddress(link.getAttribute('href')))}`)]
            : [];
    });
    return !generic.length ? check('link-generic', t.labels.linkGeneric, 'pass', t.genericOk)
        : check('link-generic', t.labels.linkGeneric, 'warn', `${t.generic(generic.length)}${alike(generic) ? ` ${generic[0]!.summary}` : ''}`, undefined, generic);
}

function linkChecks(): SeoReport['links'] {
    const { seo: t, found } = messages();
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
        .map(link => issue('link-text', link, t.textlessSummary, `${t.comments.textless}${foundLine(found.address, writtenAddress(link.getAttribute('href')))}`));
    const broken = links.flatMap(link => {
        const reason = brokenReason(link, t.broken);
        return reason ? [issue('link-address', link, reason, `${t.comments.broken(reason)}${foundLine(found.linkText, accessibleText(link))}${foundLine(found.address, writtenAddress(link.getAttribute('href')))}`)] : [];
    });
    return {
        total: links.length, internal, external,
        checks: !links.length ? [check('link-text', t.labels.links, 'none', t.noLinks)] : [
            textless.length ? check('link-text', t.labels.linkText, 'warn', t.textless(textless.length), undefined, textless)
                : check('link-text', t.labels.linkText, 'pass', t.linkTextOk),
            // Why goes in the reason when every link shares it, since the rows then show only the links
            broken.length ? check('link-address', t.labels.linkAddress, 'warn', broken.length === 1 ? t.brokenOne(broken[0]!.summary)
                : `${t.brokenMany(broken.length)}${alike(broken) ? ` ${broken[0]!.summary}` : ''}`, undefined, broken)
                : check('link-address', t.labels.linkAddress, 'pass', t.linksOk),
            genericLinkCheck(links)
        ]
    };
}

/** Images that say nothing to search engines and screen readers: no `alt`, and not marked as decoration */
function imageChecks(): SeoReport['images'] {
    const { seo: t, found } = messages();
    const images = [...document.querySelectorAll('img')];
    const missing = images.filter(image => !image.hasAttribute('alt') && !/^(presentation|none)$/.test(image.getAttribute('role') ?? '')
        && !image.closest('[aria-hidden="true"]'))
        .map(image => issue('alt', image, t.altSummary, `${t.comments.alt}${foundLine(found.image, writtenAddress(image.getAttribute('src') || image.currentSrc))}`));
    return {
        total: images.length,
        checks: [!images.length ? check('alt', t.labels.alt, 'none', t.noImages)
            : missing.length ? check('alt', t.labels.alt, 'warn', t.altMissing(missing.length), undefined, missing)
                : check('alt', t.labels.alt, 'pass', t.altOk)]
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
