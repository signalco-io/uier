// Keyboard: the page's tab order (packages/toolbar/docs/page-checks-keyboard.md), and a manual check of
// the focus indicators that moves the focus through it. Plain data and page elements only.
import { elementLabel, foundLine, isToolbarNode, oneLine } from '../pageElements';
import type { PageCheck, PageIssue } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

export type HiddenReason = 'no size' | 'off screen' | 'transparent' | 'clipped';

export type TabStop = {
    element: Element;
    /** Its tabindex, when above 0: it jumps ahead of the page's order */
    tabindex?: number;
    /** Why it cannot be seen, when it cannot */
    hidden?: HiddenReason;
    /** An in-page link hidden until it has the focus, like "Skip to content" (`hidden` says it is hidden now) */
    skipLink?: boolean;
};

export type KeyboardDetails = { stops: TabStop[] };


const focusable = 'a[href],area[href],button,input,select,textarea,iframe,summary,audio[controls],video[controls],[contenteditable],[tabindex]';

function nativelyFocusable(element: Element) {
    switch (element.localName) {
        case 'input': return (element as HTMLInputElement).type !== 'hidden';
        case 'a': case 'area': return element.hasAttribute('href');
        case 'summary': return element.parentElement?.localName === 'details' && element.parentElement.querySelector(':scope > summary') === element;
        case 'button': case 'select': case 'textarea': case 'iframe': case 'audio': case 'video': return true;
        // An editing host, not the elements inside it
        default: return (element as HTMLElement).isContentEditable && !(element.parentElement as HTMLElement | null)?.isContentEditable;
    }
}

/** Its tabindex when the Tab key stops on it: focusable, not disabled, rendered and not negative */
function tabIndexOf(element: Element): number | undefined {
    // The toolbar's own menus' focus guards (on the page's body until a closing menu is gone; src/focusGuards.ts) are not
    // the page's. The page's own guards are its stops like any other
    if (!element.matches(focusable) || element.hasAttribute('data-uier-focus-guard')) return undefined;
    const own = element.hasAttribute('tabindex');
    const index = (element as HTMLElement).tabIndex;
    if (own ? !(index >= 0) : !nativelyFocusable(element)) return undefined;
    if (element.matches(':disabled') || !element.checkVisibility({ visibilityProperty: true })) return undefined;
    return own ? index : 0;
}

/** An element, or the owner of a focus scope (a shadow host, a slot) whose stops come in its place */
type Entry = { element: Element; index: number; self: boolean; scope?: Entry[] };

function scopeOf(children: Iterable<Element>): Entry[] {
    const entries: Entry[] = [];
    const visit = (element: Element) => {
        if (element.hasAttribute('inert')) return;
        const shadow = element.shadowRoot;
        if ((shadow || element.hasAttribute('data-uier-thread')) && isToolbarNode(element)) return;
        const index = tabIndexOf(element);
        if (shadow) {
            // A host with a negative tabindex keeps its shadow tree out of the order; one that delegates focus is no stop itself
            if (element.hasAttribute('tabindex') && (element as HTMLElement).tabIndex < 0) return;
            entries.push({ element, index: index ?? 0, self: index !== undefined && !shadow.delegatesFocus, scope: scopeOf(shadow.children) });
            return;
        }
        if (element.localName === 'slot' && element.getRootNode() instanceof ShadowRoot) {
            const assigned = (element as HTMLSlotElement).assignedElements();
            entries.push({ element, index: 0, self: false, scope: scopeOf(assigned.length ? assigned : element.children) });
            return;
        }
        if (index !== undefined) entries.push({ element, index, self: true });
        for (const child of element.children) visit(child);
    };
    for (const child of children) visit(child);
    return entries;
}

/** Positive tabindex first in ascending order, then the rest in tree order; each scope's stops in its owner's place */
function flatten(entries: Entry[]): Element[] {
    const rank = (entry: Entry) => entry.index > 0 ? entry.index : Number.MAX_SAFE_INTEGER;
    return [...entries].sort((a, b) => rank(a) - rank(b))
        .flatMap(entry => [...entry.self ? [entry.element] : [], ...entry.scope ? flatten(entry.scope) : []]);
}

function namedRadio(element: Element): element is HTMLInputElement {
    return element instanceof HTMLInputElement && element.type === 'radio' && element.name !== '';
}

/** A radio group is one stop: its checked radio, else its first */
function oneStopPerRadioGroup(elements: Element[]) {
    const owners = new Map<Node, number>();
    const groups = new Map<string, HTMLInputElement[]>();
    for (const element of elements) {
        if (!namedRadio(element)) continue;
        const owner = element.form ?? element.getRootNode();
        if (!owners.has(owner)) owners.set(owner, owners.size);
        const key = `${owners.get(owner)}:${element.name}`;
        groups.set(key, [...groups.get(key) ?? [], element]);
    }
    const kept = new Set([...groups.values()].map(group => group.find(radio => radio.checked) ?? group[0]));
    return elements.filter(element => !namedRadio(element) || kept.has(element));
}

/** The parent in the flat tree: a slotted element's slot, a shadow root's host */
function flatParent(element: Element): Element | null {
    const root = element.getRootNode();
    return element.assignedSlot ?? element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/** `clip` or `clip-path` that leaves nothing to see (the "visually hidden" pattern) */
function clipsAll(style: CSSStyleDeclaration) {
    const clip = /^rect\((.*)\)$/.exec(style.clip);
    if (clip && /^(absolute|fixed)$/.test(style.position)) {
        const [top = NaN, right = NaN, bottom = NaN, left = NaN] = clip[1]!.split(/[\s,]+/).map(Number.parseFloat);
        if (right - left < 2 || bottom - top < 2) return true;
    }
    const inset = /^inset\(([\d.]+)%/.exec(style.clipPath);
    return Boolean(inset && Number(inset[1]) >= 50);
}

/** Why the element cannot be seen: no size, off the page (where nobody can scroll), fully transparent or clipped away */
export function hiddenReason(element: Element): HiddenReason | undefined {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return 'no size';
    if (rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0) return 'off screen';
    let clipped = false;
    for (let node: Element | null = element, own = true; node && node !== document.documentElement; node = flatParent(node), own = false) {
        const style = getComputedStyle(node);
        if (style.opacity === '0') return 'transparent';
        if (clipsAll(style)) clipped = true;
        else if (!own && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
            const box = node.getBoundingClientRect();
            if (box.width < 2 || box.height < 2) clipped = true;
        }
    }
    return clipped ? 'clipped' : undefined;
}

/** Hidden, but a visible label stands in for it (a styled checkbox) */
function labelShows(element: Element) {
    return [...(element as HTMLInputElement).labels ?? []].some(label => !hiddenReason(label));
}

/** An in-page link to a target on the page ("Skip to content") */
function inPageLink(element: Element) {
    const href = element.localName === 'a' ? element.getAttribute('href') ?? '' : '';
    if (!/^#./.test(href)) return false;
    try {
        const id = decodeURIComponent(href.slice(1));
        return Boolean(document.getElementById(id) ?? document.getElementsByName(id)[0]);
    } catch {
        return false;
    }
}

/**
 * The page's sequential focus order, as the Tab key moves: focusable elements that are not disabled,
 * not inert (nor outside an open modal dialog), rendered, without a negative tabindex; positive tabindex
 * first in ascending order, then document order; open shadow roots in their host's place; a radio group
 * and a frame one stop each; the toolbar left out.
 */
export function tabOrder(): TabStop[] {
    const root = document.querySelector(':modal') ?? document.body ?? document.documentElement;
    return oneStopPerRadioGroup(flatten(scopeOf([root]))).map(element => {
        const index = (element as HTMLElement).tabIndex;
        const hidden = hiddenReason(element);
        return {
            element,
            tabindex: element.hasAttribute('tabindex') && index > 0 ? index : undefined,
            hidden: hidden && !labelShows(element) ? hidden : undefined,
            skipLink: inPageLink(element) || undefined
        };
    });
}

export type TabOrderLayout = {
    /** The numbers drawn: the first `limit` stops in the window, at their element's top-left corner (kept inside the window) */
    markers: { n: number; x: number; y: number }[];
    /** Stops in the window, drawn or not */
    inView: number;
    /** An SVG path: a line with an arrow from each drawn stop to the next (and from the one before it), clear of the numbers */
    path: string;
};

/** Where the overlay draws the tab order now, in the window's coordinates (measured on every layout change) */
export function tabOrderLayout(stops: readonly TabStop[], limit: number): TabOrderLayout {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 10), max - 10);
    const points = stops.map(({ element }) => {
        const rect = element.isConnected ? element.getBoundingClientRect() : undefined;
        // Not rendered now: no number, and no line to it
        if (!rect || (!rect.width && !rect.height && !rect.left && !rect.top)) return undefined;
        const inView = rect.bottom >= 0 && rect.top <= height && rect.right >= 0 && rect.left <= width;
        return inView ? { x: clamp(rect.left, width), y: clamp(rect.top, height), inView } : { x: rect.left, y: rect.top, inView };
    });
    const inView = points.flatMap((point, index) => point?.inView ? [index] : []);
    const drawn = new Set(inView.slice(0, limit));
    let path = '';
    points.forEach((from, index) => {
        const to = points[index + 1];
        if (!from || !to || (!drawn.has(index) && !drawn.has(index + 1))) return;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length < 28) return;
        const [ux, uy] = [(to.x - from.x) / length, (to.y - from.y) / length];
        const [ex, ey] = [to.x - ux * 13, to.y - uy * 13];
        path += `M${from.x + ux * 13} ${from.y + uy * 13}L${ex} ${ey}M${ex - ux * 7 + uy * 4} ${ey - uy * 7 - ux * 4}L${ex} ${ey}L${ex - ux * 7 - uy * 4} ${ey - uy * 7 + ux * 4}`;
    });
    return { markers: [...drawn].map(index => ({ n: index + 1, ...points[index]! })), inView: inView.length, path };
}

/** Why they all cannot be seen, when it is one reason (the panel then says it once, not on each element) */
function sameReason(reasons: (HiddenReason | undefined)[]) {
    return reasons.every(reason => reason === reasons[0]) && reasons[0] ? ` (${words().keyboard.hidden[reasons[0]]})` : '';
}

/** What the element says, for a comment: its accessible-ish text */
function elementText(element: Element) {
    return oneLine(element.getAttribute('aria-label') || element.textContent || element.getAttribute('title'), 120);
}

function elementLines(element: Element) {
    const { found } = words();
    return `${foundLine(found.element, elementLabel(element))}${foundLine(found.text, elementText(element))}`;
}

/** The Keyboard section's report: the number of stops, positive tabindex, and stops that cannot be seen */
export function keyboardReport({ path }: SectionContext): SectionReport<KeyboardDetails> {
    const t = words().keyboard;
    const stops = tabOrder();
    const issue = (id: string, element: Element, summary: string, comment: string) =>
        pageIssue(path, { type: 'accessibility', id }, element, summary, comment);
    const frames = stops.filter(stop => stop.element.localName === 'iframe').length;
    const jumps = stops.filter(stop => stop.tabindex);
    const hidden = stops.filter(stop => stop.hidden && !stop.skipLink);
    const skipLinks = stops.filter(stop => stop.hidden && stop.skipLink).length;
    const skipNote = skipLinks ? t.skipNote(skipLinks) : '';
    const checks: PageCheck[] = [
        pageCheck('tab-stops', t.tabStops, 'none', stops.length ? t.order(frames) : t.noStops, { measure: String(stops.length) }),
        jumps.length
            ? pageCheck('tab-positive-tabindex', t.positive, 'warn', t.jumps(jumps.length), {
                issues: jumps.map(stop => issue('tab-positive-tabindex', stop.element, `tabindex="${stop.tabindex}"`,
                    `${t.jumpComment(stop.tabindex!)}${elementLines(stop.element)}`))
            })
            : pageCheck('tab-positive-tabindex', t.positive, 'pass', t.noPositive),
        hidden.length
            ? pageCheck('tab-hidden-stop', t.hiddenStops, 'warn', t.hiddenFound(hidden.length, sameReason(hidden.map(stop => stop.hidden)), skipNote), {
                issues: hidden.map(stop => issue('tab-hidden-stop', stop.element, t.cannotBeSeen(t.hidden[stop.hidden!]),
                    `${t.hiddenComment(t.hidden[stop.hidden!])}${elementLines(stop.element)}`))
            })
            : pageCheck('tab-hidden-stop', t.hiddenStops, 'pass', t.allSeen(skipNote))
    ];
    return { checks, details: { stops } };
}

// The manual check: focus indicators (WCAG 2.4.7)

/** Stops the focus check moves through, at most */
export const focusLimit = 100;

const sides = ['top', 'right', 'bottom', 'left'];

/** What a person sees change on focus, as one string: outline, border, box shadow, background, text decoration, colour */
function looks(element: Element, pseudo?: string) {
    const style = getComputedStyle(element, pseudo);
    if (pseudo && (style.content === 'none' || style.content === 'normal')) return '';
    const value = (name: string) => style.getPropertyValue(name);
    const line = (prefix: string) => /^(none|hidden)$/.test(value(`${prefix}-style`)) || !Number.parseFloat(value(`${prefix}-width`))
        ? 'none' : `${value(`${prefix}-style`)} ${value(`${prefix}-width`)} ${value(`${prefix}-color`)}`;
    return [line('outline'), value('outline-offset'), ...sides.map(side => line(`border-${side}`)), style.boxShadow, style.backgroundColor,
        style.backgroundImage, style.textDecorationLine === 'none' ? 'none' : `${style.textDecorationLine} ${style.textDecorationStyle} ${style.textDecorationColor}`,
        style.color, style.opacity, style.transform, style.visibility, pseudo ? `${style.content} ${style.width} ${style.height}` : ''].join('|');
}

/** The element, its pseudo-elements, the ancestors that may react with `:focus-within`, its first descendants and its labels */
function observedParts(element: Element): Element[] {
    const parts = [element];
    for (let node = flatParent(element), depth = 0; node && depth < 4 && node !== document.body && node !== document.documentElement; node = flatParent(node), depth++) parts.push(node);
    parts.push(...[...element.querySelectorAll('*')].slice(0, 4), ...(element as HTMLInputElement).labels ?? []);
    // A styled checkbox: the box beside the hidden input (`input:focus-visible + span`)
    if (element.localName === 'input' && element.nextElementSibling) parts.push(element.nextElementSibling);
    return parts;
}

function signature(parts: Element[]) {
    // A transition would still show the style before the focus: it is finished first
    for (const part of parts) {
        for (const animation of part.getAnimations({ subtree: part === parts[0] })) {
            if (typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition) animation.finish();
        }
    }
    return parts.map(part => `${looks(part)}#${looks(part, '::before')}#${looks(part, '::after')}`).join('\n');
}

/** The focused element, inside open shadow roots too */
function activeElement(): Element | null {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
}

function blurActive() {
    (activeElement() as HTMLElement | null)?.blur?.();
}

/** The next frame, where a script's indicator shows (a timeout in a hidden tab) */
function nextFrame() {
    return new Promise<void>(resolve => {
        const timer = window.setTimeout(resolve, 100);
        requestAnimationFrame(() => {
            window.clearTimeout(timer);
            resolve();
        });
    });
}

export type FocusDetails = {
    /** The browser showed no keyboard focus styles for a script's focus: nothing was reported */
    untrusted?: boolean;
};

/**
 * Moves the focus through the page's tab stops (at most `focusLimit`, frames skipped) and reports the
 * ones that look the same focused as not, comparing the computed styles of the element, its pseudo-
 * elements, nearby ancestors, first descendants and labels. Each focus asks for the keyboard's focus
 * styles (`focusVisible`); a stop that still does not match `:focus-visible` (a browser without that
 * option, after a click) makes the whole result untrustworthy, and it says so instead. The focus
 * and the window's scroll are put back in `finally`, also when cancelled: by the section's signal
 * (rejects), or by `cancel` (the panel closed: nothing to show).
 */
export async function checkFocusIndicators(context: SectionContext, cancel: AbortSignal): Promise<SectionReport<FocusDetails> | undefined> {
    try {
        return await focusReport(context.path, AbortSignal.any([context.signal, cancel]));
    } catch (error) {
        if (cancel.aborted && !context.signal.aborted) return undefined;
        throw error;
    }
}

async function focusReport(path: string, signal: AbortSignal): Promise<SectionReport<FocusDetails>> {
    const stops = tabOrder();
    const checked = stops.slice(0, focusLimit);
    const previous = activeElement();
    const { scrollX, scrollY } = window;
    const t = words().keyboard;
    const plain: PageIssue[] = [];
    const unseen: PageIssue[] = [];
    const unseenReasons: HiddenReason[] = [];
    let frames = 0;
    let missed = 0;
    let done = 0;
    let untrusted = false;
    try {
        for (const { element } of checked) {
            signal.throwIfAborted();
            // Frames are other documents (maybe other sites): their focus is theirs
            if (/^(iframe|object|embed)$/.test(element.localName)) {
                frames++;
                continue;
            }
            // A clean "before": nothing on the page has the focus (so no `:focus-within` either)
            blurActive();
            const parts = element.isConnected ? observedParts(element) : [];
            const before = signature(parts);
            (element as HTMLElement).focus({ preventScroll: true, focusVisible: true } as FocusOptions);
            if (activeElement() !== element) {
                missed++;
                continue;
            }
            if (!element.matches(':focus-visible')) {
                untrusted = true;
                break;
            }
            await nextFrame();
            signal.throwIfAborted();
            if (activeElement() !== element) {
                missed++;
                continue;
            }
            done++;
            // Read after its transitions finished: a skip link slides in
            const after = signature(parts);
            const lines = elementLines(element);
            const hidden = hiddenReason(element);
            if (hidden && !labelShows(element)) {
                unseenReasons.push(hidden);
                unseen.push(pageIssue(path, { type: 'accessibility', id: 'focus-hidden' }, element, t.notVisibleFocused(t.hidden[hidden]),
                    `${t.notVisibleComment(t.hidden[hidden])}${lines}`));
            } else if (after === before) {
                plain.push(pageIssue(path, { type: 'accessibility', id: 'focus-indicator' }, element, t.noChange,
                    `${t.noChangeComment}${lines}`));
            }
        }
    } finally {
        blurActive();
        if (previous && previous !== document.body && previous.isConnected) (previous as HTMLElement).focus?.({ preventScroll: true });
        window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    }
    if (untrusted) {
        return {
            checks: [pageCheck('focus-indicator', t.indicators, 'none', t.untrusted)],
            details: { untrusted }
        };
    }
    const skipped = [
        stops.length > checked.length && t.afterFirst(stops.length - checked.length, focusLimit),
        frames && t.frames(frames),
        missed && t.lostFocus(missed)
    ].filter(Boolean);
    const note = skipped.length ? t.notCheckedNote(skipped.join(', ')) : '';
    const checks = [plain.length
        ? pageCheck('focus-indicator', t.indicators, 'warn', t.noChangeCount(plain.length, done, note), { issues: plain })
        : pageCheck('focus-indicator', t.indicators, done ? 'pass' : 'none', done ? t.eachChanged(done, note) : t.nothingToCheck(note))];
    if (unseen.length) checks.push(pageCheck('focus-hidden', t.hiddenFocused, 'warn', t.hiddenFocusedCount(unseen.length, sameReason(unseenReasons)), { issues: unseen }));
    return { checks, details: {} };
}
