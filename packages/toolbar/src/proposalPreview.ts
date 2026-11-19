import { changeProposalTextMaxLength, changeStyleProperties, isChangeProposal, isChangeStyleValue } from './changeProposal';
import type { ChangeProposal, ChangeStyleProperty } from './changeProposal';
import type { CommentAnchor, CommentItemPosition } from './components/@types/Comments';
import { isCommentArea } from './components/@types/Comments';
import { resolvePreviewAnchor, resolvePreviewTextRange, trackPreviewTextRange } from './hooks/useCommentItemRects';
import { getToolbarHost } from './mount';
import { isToolbarAnchor } from './toolbarReview';

type StyleValues = Partial<Record<ChangeStyleProperty, string>>;
type TextPart = { node: Text; start: number; end: number };
type TextPatch = { node: Text; parent: Element | null; before: string; preview: string; owned: boolean };
type Declaration = { value: string; priority: string };
type StylePatch = { name: string; before: Declaration; preview: Declaration; owned: boolean };
type Target = NonNullable<ReturnType<typeof resolvePreviewAnchor>> & { element: HTMLElement | SVGElement };

const excluded = 'head,script,style,noscript,template,iframe,embed,object,form,input,textarea,select,option,datalist,output,button[form],'
    + '[contenteditable]:not([contenteditable="false" i]),[role~="textbox" i],[role~="searchbox" i],[role~="combobox" i],'
    + '[role~="spinbutton" i],[inert],[data-uier-thread]';
const radiusCorners = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
const logicalPadding = ['padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end'];
const logicalRadius = ['border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius'];
const styleFamilies = [
    { physical: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], logical: logicalPadding },
    { physical: radiusCorners, logical: logicalRadius },
];

function canPreview(element: Element) {
    return element.getRootNode() === document && document.designMode.toLowerCase() !== 'on'
        && !getToolbarHost()?.contains(element) && !element.closest(excluded);
}

function previewTarget(position: CommentAnchor): Target | null {
    if (isCommentArea(position) || isToolbarAnchor(position)) return null;
    const target = resolvePreviewAnchor(position);
    if (!target || !(target.element instanceof HTMLElement || target.element instanceof SVGElement)
        || target.element === document.body || target.element === document.documentElement
        || !canPreview(target.element) || !canPreview(target.end)) return null;
    return { element: target.element, end: target.end };
}

function canPreviewText(node: Text) {
    const element = node.parentElement;
    return element instanceof HTMLElement && canPreview(element) && !element.closest('[aria-hidden="true" i]')
        && (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
}

function* textNodes(root: Node): Generator<Text> {
    if (root instanceof Text) {
        yield root;
        return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Text;
}

function selectedParts(range: Range) {
    const parts: TextPart[] = [];
    for (const node of textNodes(range.commonAncestorContainer)) {
        if (!range.intersectsNode(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        if (start === end) continue;
        if (!canPreviewText(node)) return null;
        parts.push({ node, start, end });
    }
    return parts.length ? parts : null;
}

function textOf(parts: TextPart[]) {
    return parts.map(({ node, start, end }) => node.data.slice(start, end)).join('');
}

/** Authoring and replay use all visible text on the pinned element, excluding icons and editors. */
function pointTextParts(element: Element) {
    const parts: TextPart[] = [];
    for (const node of textNodes(element)) {
        if (node.length && canPreviewText(node)) parts.push({ node, start: 0, end: node.length });
    }
    return parts;
}

function targetText(position: CommentAnchor, target: Target, quote?: string) {
    const range = position.type === 'text' ? resolvePreviewTextRange(position, target.element, target.end) : undefined;
    const parts = position.type === 'point' ? pointTextParts(target.element) : range && selectedParts(range);
    if (!parts) return null;
    const text = textOf(parts);
    if (!text.trim() || text.length > changeProposalTextMaxLength
        || (range && !range.getClientRects().length)
        || (quote !== undefined && quote !== text && !(position.type === 'text' && quote === position.text))) return null;
    return { text, parts };
}

export function readProposalTarget(position: CommentItemPosition, quotedText?: string): { text?: string; styles: StyleValues } | null {
    if (position.type === 'page') return null;
    const target = previewTarget(position);
    if (!target || (position.type === 'text' && !resolvePreviewTextRange(position, target.element, target.end))) return null;
    const text = targetText(position, target, quotedText)?.text;
    const computed = getComputedStyle(target.element);
    const styles: StyleValues = {};
    for (const property of changeStyleProperties) {
        const value = computed.getPropertyValue(property).trim();
        if (isChangeStyleValue(property, value)) styles[property] = value;
    }
    return { text, styles };
}

function rangeOf(parts: TextPart[]) {
    const first = parts[0]!;
    const last = parts.at(-1)!;
    const range = document.createRange();
    range.setStart(first.node, first.start);
    range.setEnd(last.node, last.end);
    return range;
}

function planText(parts: TextPart[], original: string, proposed: string) {
    let prefix = 0;
    while (prefix < original.length && prefix < proposed.length && original[prefix] === proposed[prefix]) prefix++;
    let suffix = 0;
    while (suffix < original.length - prefix && suffix < proposed.length - prefix
        && original[original.length - 1 - suffix] === proposed[proposed.length - 1 - suffix]) suffix++;

    const end = original.length - suffix;
    const replacement = proposed.slice(prefix, proposed.length - suffix);
    const patches: TextPatch[] = [];
    let cursor = 0;
    const updated = parts.map(part => {
        const { node, start } = part;
        const next = cursor + part.end - start;
        const insertion = prefix === end && cursor <= prefix && next >= prefix;
        const overlap = cursor < end && next > prefix;
        const from = start + Math.max(prefix - cursor, 0);
        const to = start + Math.min(end - cursor, part.end - start);
        cursor = next;
        if (!insertion && !overlap) return part;
        const value = patches.length ? '' : replacement;
        const before = node.data;
        patches.push({ node, parent: node.parentElement, before, preview: before.slice(0, from) + value + before.slice(to), owned: true });
        return { node, start, end: part.end + value.length - (to - from) };
    });

    // A change can cross adjacent text nodes. Across an element boundary we cannot infer which
    // words should become part of a link, label or emphasis, or where to insert at that boundary.
    if (!patches.length || patches.some((patch, i) => i > 0 && patches[i - 1]!.node.nextSibling !== patch.node)) return null;
    const parents = updated.map(({ node }) => node.parentElement);
    const range = () => {
        if (updated.some(({ node, end }, index) => !node.isConnected || node.parentElement !== parents[index] || end > node.length)) return null;
        const live = rangeOf(updated);
        return live.toString() === proposed ? live : null;
    };
    return { patches: patches.filter(edit => edit.before !== edit.preview), range };
}

function declaration(style: CSSStyleDeclaration, name: string): Declaration {
    return { value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) };
}

function hasDeclaration(style: CSSStyleDeclaration, { name, preview }: StylePatch) {
    return style.getPropertyValue(name) === preview.value && style.getPropertyPriority(name) === preview.priority;
}

function planStyles(element: Target['element'], styles: ChangeProposal['styles']) {
    const computed = getComputedStyle(element);
    const parsed = document.createElement('span').style;
    const inlineNames = new Set(Array.from(element.style));
    const patches: StylePatch[] = [];
    for (const property of changeStyleProperties) {
        const change = styles[property];
        if (!change) continue;
        if (computed.getPropertyValue(property).trim() !== change.original || !CSS.supports(property, change.proposed)) return null;
        parsed.setProperty(property, change.proposed, 'important');
        for (const name of property === 'border-radius' ? radiusCorners : [property]) {
            const preview = declaration(parsed, name);
            const before = declaration(element.style, name);
            // The CSSOM cannot restore one unresolved component of a shorthand such as padding: var(--space).
            if (!preview.value || (!before.value && inlineNames.has(name))) return null;
            patches.push({ name, before, preview, owned: true });
        }
    }
    return patches;
}

function restoreDeclarations(style: CSSStyleDeclaration, patches: StylePatch[], originalOrder: string[]) {
    const replacements = new Map(patches.filter(patch => patch.owned).map(patch => [patch.name, patch.before]));
    for (const { physical, logical } of styleFamilies) {
        if (!physical.some(name => replacements.get(name)?.value)
            || !logical.some(name => originalOrder.includes(name))) continue;
        const family = [...physical, ...logical];
        const currentNames = Array.from(style).filter(name => family.includes(name));
        const current = new Map(currentNames.map(name => [name, declaration(style, name)]));
        if ([...current.values()].some(item => !item.value)) continue;

        // A physical declaration moved to the end for preview can otherwise win over an
        // equally important logical declaration after cleanup. Keep the host's current order
        // and reinsert owned declarations at their original positions within this family.
        const names = currentNames.filter(name => !replacements.has(name));
        let next = names.length;
        for (const name of originalOrder.filter(name => family.includes(name)).reverse()) {
            const index = names.indexOf(name);
            if (index >= 0) next = index;
            else if (replacements.get(name)?.value) names.splice(next, 0, name);
        }
        for (const name of currentNames) style.removeProperty(name);
        for (const name of names) {
            const { value, priority } = replacements.get(name) ?? current.get(name)!;
            style.setProperty(name, value, priority);
        }
        for (const name of physical) replacements.delete(name);
    }
    for (const [name, before] of replacements) style.setProperty(name, before.value, before.priority);
}

let activePreview: { invalidate: () => void } | undefined;

export function startProposalPreview(position: CommentItemPosition, proposal: ChangeProposal, onInvalidated?: () => void): (() => void) | null {
    if (position.type === 'page' || !isChangeProposal(proposal)) return null;
    const anchor: CommentAnchor = position;
    activePreview?.invalidate();
    if (activePreview) return null;

    const target = previewTarget(position);
    if (!target) return null;
    const { element, end } = target;
    if (position.type === 'text' && !resolvePreviewTextRange(position, element, end)) return null;
    const live = proposal.text ? targetText(position, target, proposal.text.original) : null;
    const text = proposal.text && live?.text === proposal.text.original
        ? planText(live.parts, live.text, proposal.text.proposed) : null;
    if (proposal.text && !text) return null;
    const plannedStyles = planStyles(element, proposal.styles);
    if (!plannedStyles) return null;
    const styles = plannedStyles;

    const hadStyleAttribute = element.hasAttribute('style');
    const originalStyle = element.style.cssText;
    const originalOrder = Array.from(element.style);
    const oldStyle = document.createElement('span').style;
    const url = location.href;
    for (const edit of text?.patches ?? []) edit.node.data = edit.preview;
    if (styles.length) {
        oldStyle.cssText = originalStyle;
        for (const { name, preview } of styles) {
            oldStyle.removeProperty(name);
            oldStyle.setProperty(name, preview.value, preview.priority);
        }
        element.style.cssText = oldStyle.cssText;
    }
    const appliedStyle = oldStyle.cssText;

    const untrack = text && position.type === 'text' ? trackPreviewTextRange(position, element, text.range) : undefined;
    const navigation = window.navigation;
    let styleWritten = styles.length > 0 && element.style.cssText !== appliedStyle;

    function detectHostWrites(records: MutationRecord[]) {
        for (const record of records) {
            if (record.type === 'characterData') {
                const edit = text?.patches.find(edit => edit.node === record.target);
                if (edit) edit.owned = false;
            }
            if (record.target === element && record.attributeName === 'style') {
                styleWritten = true;
                oldStyle.cssText = record.oldValue ?? '';
                for (const patch of styles) patch.owned &&= hasDeclaration(oldStyle, patch);
            }
        }
        for (const patch of styles) patch.owned &&= hasDeclaration(element.style, patch);
    }

    function finish() {
        if (activePreview !== session) return false;
        activePreview = undefined;
        detectHostWrites(observer.takeRecords());
        observer.disconnect();
        untrack?.();
        navigation?.removeEventListener('currententrychange', navigated);
        window.removeEventListener('popstate', navigated);
        window.removeEventListener('hashchange', navigated);
        window.removeEventListener('pagehide', invalidate);

        for (const edit of text?.patches ?? []) {
            // A framework can detach the old node, or reuse it with its own text while we preview.
            const parent = edit.node.parentElement;
            if (edit.owned && edit.node.data === edit.preview
                && (!parent || parent === edit.parent || canPreviewText(edit.node))) edit.node.data = edit.before;
        }
        if (styles.length && !styleWritten && element.style.cssText === appliedStyle) {
            if (hadStyleAttribute) element.style.cssText = originalStyle;
            else element.removeAttribute('style');
        } else {
            restoreDeclarations(element.style, styles, originalOrder);
        }
        return true;
    }

    function invalidate() { if (finish()) onInvalidated?.(); }
    function navigated() { if (location.href !== url) invalidate(); }

    function isCurrent() {
        const current = previewTarget(anchor);
        return location.href === url && current?.element === element && current.end === end
            && styles.every(patch => patch.owned)
            && (!text || (text.patches.every(edit => edit.owned && edit.node.parentElement === edit.parent && canPreviewText(edit.node))
                && (position.type === 'point' ? textOf(pointTextParts(element)) === proposal.text?.proposed : Boolean(text.range()))));
    }

    const observer = new MutationObserver(records => {
        detectHostWrites(records);
        if (!isCurrent()) invalidate();
    });
    const session = { invalidate };
    activePreview = session;
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    // Keep ownership evidence even if a renderer removes and then modifies the old nodes.
    observer.observe(element, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    for (const edit of text?.patches ?? []) observer.observe(edit.node, { characterData: true });
    navigation?.addEventListener('currententrychange', navigated);
    window.addEventListener('popstate', navigated);
    window.addEventListener('hashchange', navigated);
    window.addEventListener('pagehide', invalidate);
    detectHostWrites([]);
    if (!isCurrent()) {
        finish();
        return null;
    }
    return () => { finish(); };
}
