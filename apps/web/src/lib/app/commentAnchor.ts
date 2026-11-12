import { englishAppTranslator } from '../i18n/translate';
import type { AppTranslator } from '../i18n/types';
import { toolbarPartLabel } from '@uier/toolbar/feedback-context';
import type { DbCommentKind, DbCommentPosition } from '../db/schema';

/** What a thread was left on, in words: an element ("Link in navigation"), selected text or the whole page */
export type CommentAnchorView =
    | { type: 'element' | 'area'; label: string; selector: string }
    | { type: 'text'; label: string; text: string }
    | { type: 'page'; label: string };

const tagWords: Record<string, string> = {
    a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Image', video: 'Video', audio: 'Audio',
    h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
    p: 'Paragraph', blockquote: 'Quote', pre: 'Code', code: 'Code', ul: 'List', ol: 'List', li: 'List item',
    nav: 'Navigation', header: 'Header', footer: 'Footer', main: 'Main content', aside: 'Sidebar',
    section: 'Section', article: 'Article', form: 'Form', input: 'Form field', textarea: 'Form field',
    select: 'Form field', label: 'Label', table: 'Table', tr: 'Table row', td: 'Table cell', th: 'Table cell',
    figure: 'Figure', figcaption: 'Caption', dialog: 'Dialog', iframe: 'Embedded frame'
};

/** The landmarks worth naming as the place an element is in */
const places: Record<string, string> = {
    nav: 'navigation', header: 'header', footer: 'footer', aside: 'sidebar', form: 'form', dialog: 'dialog', table: 'table'
};

function tagOf(part: string) {
    return /^([a-z][a-z0-9-]*)/i.exec(part.trim())?.[1]?.toLowerCase();
}

/**
 * "Link in navigation" for `body>header>nav>a:nth-of-type(3)`, "Button in uier comment thread" for a
 * part of uier's own toolbar (`#uier-toolbar>>>div.uier-thread>…`). Saved selectors come from
 * reviewers' browsers: only their tag names and toolbar part names are read, and the result is plain text.
 */
export function elementLabel(selector: string, t: AppTranslator = englishAppTranslator) {
    const part = toolbarPartLabel(selector);
    if (part) {
        const tag = tagOf(selector.split(',')[0]?.split('>').at(-1) ?? '');
        return t('{element} in uier {part}', { element: t((tag && tagWords[tag]) ?? 'Element'), part: t(part) });
    }
    // The first of alternative selectors (`a,b`), then its parts from the outermost
    const parts = (selector.split(',')[0] ?? '').split('>').map(part => part.trim()).filter(Boolean);
    const tags = parts.map(tagOf);
    const tag = tags.at(-1);
    const word = t((tag && tagWords[tag]) ?? 'Element');
    const place = tags.slice(0, -1).reverse().find(ancestor => ancestor && places[ancestor] && ancestor !== tag);
    return place ? t('{element} in {place}', { element: word, place: t(places[place]!) }) : word;
}

/** ", after opening Account": the anchor is in a menu, popover or dialog that a page element opens */
function openedFrom(position: DbCommentPosition, t: AppTranslator) {
    if (position.type === 'page' || !position.layer) return '';
    const name = position.layer.label?.replace(/\s+/g, ' ').trim();
    return name ? t(', after opening “{name}”', { name }) : t(', in a menu or dialog');
}

export function commentAnchor(position: DbCommentPosition, kind: DbCommentKind | undefined, quotedText?: string, t: AppTranslator = englishAppTranslator): CommentAnchorView {
    if (position.type === 'text') {
        const text = (quotedText || position.text).replace(/\s+/g, ' ').trim();
        return { type: 'text', label: `${t(kind === 'rewrite' ? 'Suggested rewrite of selected text' : 'Selected text')}${openedFrom(position, t)}`, text };
    }
    if (position.type === 'point') {
        const element = elementLabel(position.selector, t);
        const area = typeof position.widthNormal === 'number' && typeof position.heightNormal === 'number';
        return area
            ? { type: 'area', label: `${t('Area of {element}', { element: element.charAt(0).toLowerCase() + element.slice(1) })}${openedFrom(position, t)}`, selector: position.selector }
            : { type: 'element', label: `${element}${openedFrom(position, t)}`, selector: position.selector };
    }
    return { type: 'page', label: t(kind === 'bug' ? 'Bug report about the page' : 'Whole page') };
}
