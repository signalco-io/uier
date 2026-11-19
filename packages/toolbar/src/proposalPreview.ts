import { hasIndependentAnchorSelector, withoutAnchorOrdinals } from './anchorSelector';
import { changeProposalTextMaxLength, changeStyleProperties, isChangeProposal, isChangeStyleValue, isProposalLabelHash } from './changeProposal';
import type { ChangeProposal, ChangeStyleProperty } from './changeProposal';
import type { CommentAnchor, CommentItemPosition, CommentPoint } from './components/@types/Comments';
import { isCommentArea } from './components/@types/Comments';
import { previewTextOffsets, resolvePreviewAnchor, resolvePreviewTextRange, trackPreviewTextRange } from './hooks/useCommentItemRects';
import { getToolbarHost } from './mount';
import { isToolbarAnchor, queryAnchorElements } from './toolbarReview';

type StyleValues = Partial<Record<ChangeStyleProperty, string>>;
type TextPart = { node: Text; start: number; end: number };
type TextPatch = { node: Text; parent: Element | null; before: string; preview: string; owned: boolean };
type Declaration = { value: string; priority: string };
type StylePatch = { name: string; before: Declaration; preview: Declaration; owned: boolean };
type Target = NonNullable<ReturnType<typeof resolvePreviewAnchor>> & { element: HTMLElement | SVGElement };
type PreviewSelection = NonNullable<ReturnType<typeof resolvePreviewTextRange>>;

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

const maxLabelNodes = 128;
const maxLabelCandidates = 128;

function pointLabel(element: Element, before?: ReadonlyMap<Text, string>) {
    let text = '';
    let nodes = 0;
    for (const node of textNodes(element)) {
        if (++nodes > maxLabelNodes) return undefined;
        const original = before?.get(node);
        const length = original?.length ?? node.length;
        if (!length || !canPreviewText(node)) continue;
        if (text.length + length > changeProposalTextMaxLength) return undefined;
        text += original ?? node.data;
    }
    return text.trim().replace(/\s+/g, ' ') || undefined;
}

function labelHash(label: string) {
    // FNV-1a over the complete bounded label. Only the fingerprint leaves the page.
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < label.length; index++) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(label.charCodeAt(index))) * 0x100000001b3n);
    }
    return `v1-${hash.toString(16).padStart(16, '0')}`;
}

function uniquePointLabel(position: CommentPoint, element: Element, label: string) {
    const alternatives = queryAnchorElements(withoutAnchorOrdinals(position.selector));
    return alternatives.length <= maxLabelCandidates && alternatives.includes(element)
        && alternatives.every(candidate => candidate === element || pointLabel(candidate) !== label);
}

/** Capture on the element the reviewer actually picked, before a draft can outlive this layout. */
export function withProposalTargetIdentity(anchor: CommentAnchor, picked?: Element): CommentAnchor {
    if (anchor.type !== 'point' || !picked || previewTarget(anchor)?.element !== picked
        || hasIndependentAnchorSelector(anchor.selector, picked)) return anchor;
    const label = pointLabel(picked);
    return label && uniquePointLabel(anchor, picked, label) ? { ...anchor, proposalLabelHash: labelHash(label) } : anchor;
}

function matchesPointIdentity(position: CommentAnchor, element: Element, original?: string, before?: ReadonlyMap<Text, string>) {
    if (position.type !== 'point') return true;
    if (position.proposalLabelHash === undefined && hasIndependentAnchorSelector(position.selector, element)) return true;
    // Legacy text proposals already record the original label. Legacy CSS-only proposals on a
    // structural selector have no identity evidence even when all their computed values match.
    const expected = position.proposalLabelHash ?? (original && labelHash(original.trim().replace(/\s+/g, ' ')));
    if (!isProposalLabelHash(expected)) return false;
    const label = pointLabel(element, before);
    return Boolean(label && labelHash(label) === expected && uniquePointLabel(position, element, label));
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

function targetText(position: CommentAnchor, target: Target, selection: PreviewSelection | undefined, quote?: string) {
    const range = selection?.range;
    const parts = position.type === 'point' ? pointTextParts(target.element) : range && selectedParts(range);
    if (!parts) return null;
    const raw = textOf(parts);
    if (!raw.trim() || raw.length > changeProposalTextMaxLength || (range && !range.getClientRects().length)) return null;
    const text = quote ?? (position.type === 'text' ? position.text : raw);
    if (text === raw) return { text, raw, parts };
    // Older rewrite messages can hold the exact captured quote with its outer whitespace trimmed.
    if (text.length > changeProposalTextMaxLength || position.type !== 'text'
        || (text !== position.text && text !== position.text.trim()) || !selection?.matches(text)) return null;
    return { text, raw, parts };
}

export function readProposalTarget(position: CommentItemPosition, quotedText?: string): { text?: string; styles: StyleValues } | null {
    if (position.type === 'page') return null;
    const target = previewTarget(position);
    if (!target || !matchesPointIdentity(position, target.element, quotedText)) return null;
    const selection = position.type === 'text' ? resolvePreviewTextRange(position, target.element, target.end) : undefined;
    if (selection === null) return null;
    const text = targetText(position, target, selection, quotedText)?.text;
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

function sourceOffsets(raw: string, quote: string, start: number, end: number) {
    if (raw === quote) return [start, end] as const;
    const source = previewTextOffsets(raw);
    const firstRendered = quote.startsWith(' ') ? 1 : 0;
    const lastRendered = quote.endsWith(' ') ? quote.length - 1 : quote.length;
    function sourceOffset(offset: number) {
        // Browsers may include a collapsed edge space in the selection. The whole run maps to
        // that space; when no edge space was selected, leave the run intact.
        if (offset < firstRendered) return source[0]! > 0 ? 0 : undefined;
        if (offset > lastRendered) return source.at(-1)! < raw.length ? raw.length : undefined;
        return source[offset - firstRendered];
    }
    const first = sourceOffset(start);
    const last = sourceOffset(end);
    return first === undefined || last === undefined ? null : [first, last] as const;
}

function planText({ parts, text: original, raw }: NonNullable<ReturnType<typeof targetText>>, proposed: string) {
    let prefix = 0;
    while (prefix < original.length && prefix < proposed.length && original[prefix] === proposed[prefix]) prefix++;
    let suffix = 0;
    while (suffix < original.length - prefix && suffix < proposed.length - prefix
        && original[original.length - 1 - suffix] === proposed[proposed.length - 1 - suffix]) suffix++;

    const offsets = sourceOffsets(raw, original, prefix, original.length - suffix);
    if (!offsets) return null;
    const [start, end] = offsets;
    const replacement = proposed.slice(prefix, proposed.length - suffix);
    const patches: TextPatch[] = [];
    let cursor = 0;
    const updated = parts.map(part => {
        const { node } = part;
        const next = cursor + part.end - part.start;
        const insertion = start === end && cursor <= start && next >= start;
        const overlap = cursor < end && next > start;
        const from = part.start + Math.max(start - cursor, 0);
        const to = part.start + Math.min(end - cursor, part.end - part.start);
        cursor = next;
        if (!insertion && !overlap) return part;
        const value = patches.length ? '' : replacement;
        const before = node.data;
        patches.push({ node, parent: node.parentElement, before, preview: before.slice(0, from) + value + before.slice(to), owned: true });
        return { node, start: part.start, end: part.end + value.length - (to - from) };
    });

    // A change can cross adjacent text nodes. Across an element boundary we cannot infer which
    // words should become part of a link, label or emphasis, or where to insert at that boundary.
    if (!patches.length || patches.some((patch, i) => i > 0 && patches[i - 1]!.node.nextSibling !== patch.node)) return null;
    const parents = updated.map(({ node }) => node.parentElement);
    const editedNodes = new Map(patches.map(({ node, preview }) => [node, preview]));
    const expected = updated.map(({ node, start, end }) => (editedNodes.get(node) ?? node.data).slice(start, end)).join('');
    const range = () => {
        if (updated.some(({ node, end }, index) => !node.isConnected || node.parentElement !== parents[index] || end > node.length)) return null;
        const live = rangeOf(updated);
        return live.toString() === expected ? live : null;
    };
    return { patches: patches.filter(edit => edit.before !== edit.preview), range };
}

function declaration(style: CSSStyleDeclaration, name: string): Declaration {
    return { value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) };
}

function hasDeclaration(style: CSSStyleDeclaration, { name, preview }: StylePatch) {
    return style.getPropertyValue(name) === preview.value && style.getPropertyPriority(name) === preview.priority;
}

function settleStyleTransitions(element: Target['element'], patches: StylePatch[]) {
    if (!patches.length || !element.isConnected) return;
    const owned = new Set(patches.filter(patch => patch.owned).map(patch => patch.name));
    if (!owned.size) return;

    // Transitions take precedence over inline !important. getAnimations flushes styles so both
    // the change and its reversal can settle synchronously, including for an original capture.
    for (const animation of element.getAnimations()) {
        if (animation instanceof CSSTransition && owned.has(animation.transitionProperty)) animation.cancel();
    }
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
    if (!matchesPointIdentity(position, element, proposal.text?.original)) return null;
    const selection = position.type === 'text' ? resolvePreviewTextRange(position, element, end) : undefined;
    if (selection === null) return null;
    const live = proposal.text ? targetText(position, target, selection, proposal.text.original) : null;
    const text = proposal.text && live ? planText(live, proposal.text.proposed) : null;
    if (proposal.text && !text) return null;
    const beforeText = text ? new Map(text.patches.map(edit => [edit.node, edit.before])) : undefined;
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
    settleStyleTransitions(element, styles.filter(patch => hasDeclaration(element.style, patch)));

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
        settleStyleTransitions(element, styles);
        return true;
    }

    function invalidate() { if (finish()) onInvalidated?.(); }
    function navigated() { if (location.href !== url) invalidate(); }

    function isCurrent() {
        const current = previewTarget(anchor);
        return location.href === url && current?.element === element && current.end === end
            && matchesPointIdentity(anchor, element, proposal.text?.original, beforeText)
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
