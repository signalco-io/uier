import { prototypeLabelLimit, prototypeNodeLimit, prototypePathLimit, prototypeScanLimit } from './prototypeEvidence';

export const prototypeBridgeName = '__uier_bridge.js';

// This script runs before uploaded scripts, in the document's opaque sandbox.
export const prototypeBridge = String.raw`(() => {
    const parentOrigin = document.currentScript.dataset.uierParent;
    const root = new URL(document.currentScript.src).pathname.slice(0, -'${prototypeBridgeName}'.length);
    const channel = root.split('/')[2];
    if (window.parent === window) return;
    const send = (type, data = {}) => window.parent.postMessage({ type: 'uier-proof:' + type,
        path: location.pathname.slice(root.length), channel, ...data }, parentOrigin);
    const sensitive = 'script, style, template, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-uier-private]';
    const candidates = 'a, button, summary, [role], p, li, h1, h2, h3, h4, img';
    const panel = '[role="menu"], [role="listbox"], [role="dialog"], dialog, [popover], details';
    const maxScan = ${prototypeScanLimit};
    let picking = false;
    let selection;
    let outline;
    let restoredRange;

    function describe(element) {
        const path = [];
        const tag = element.localName;
        if (!/^[a-z][a-z0-9-]{0,39}$/.test(tag)) return;
        while (element !== document.body) {
            const parent = element.parentElement;
            if (!parent || path.length >= ${prototypePathLimit} || parent.children.length > 4096) return;
            path.unshift(Array.prototype.indexOf.call(parent.children, element));
            element = parent;
        }
        if (path.length) return { path, tag };
    }

    function find(node) {
        let element = document.body;
        for (const part of node.path) {
            element = element?.children[part];
            if (!element) return;
        }
        if (element.localName === node.tag && !element.closest(sensitive)) return element;
    }

    function shown(element) {
        if (!element.isConnected || element.closest(sensitive + ', [hidden], [aria-hidden="true"]')) return false;
        return element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    }

    function label(element) {
        // Read visible direct text and explicit accessible labels only. Avoid
        // form data, URL attributes, DOM serialization and hidden descendants.
        let text = element.getAttribute('aria-label') || (element.localName === 'img' ? element.getAttribute('alt') : '');
        if (!text) {
            text = '';
            for (let first = element.firstChild, index = 0; first && index < 40 && text.length < 500; first = first.nextSibling, index++) {
                if (first.nodeType === Node.TEXT_NODE) text += first.data.slice(0, 500 - text.length);
                else if (first.nodeType === Node.ELEMENT_NODE && first.matches('span, b, strong, em, i, small') && shown(first) && first.childNodes.length === 1
                    && first.firstChild.nodeType === Node.TEXT_NODE) text += first.firstChild.data.slice(0, 500 - text.length);
            }
        }
        return text.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim().slice(0, ${prototypeLabelLimit}) || undefined;
    }

    function state(element) {
        const flags = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'open'];
        const values = flags.map(name => {
            if (name === 'open') return element.hasAttribute(name) ? '1' : '-';
            const value = element.getAttribute(name);
            return value === 'true' ? '1' : value === 'false' ? '0' : '-';
        });
        return values.some(value => value !== '-') ? values.join('') : undefined;
    }

    function bounds(rect) {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(innerWidth, rect.right);
        const bottom = Math.min(innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return;
        return { x: left / innerWidth, y: top / innerHeight, width: (right - left) / innerWidth, height: (bottom - top) / innerHeight };
    }

    function capture(element) {
        const nodes = [];
        const native = [];
        const used = new Set();
        const add = (item, includeWithoutLabel = false) => {
            if (used.has(item) || nodes.length >= ${prototypeNodeLimit} || !shown(item)) return false;
            const node = describe(item);
            const box = bounds(item.getBoundingClientRect());
            const text = label(item);
            if (!node || !box || (!text && !includeWithoutLabel)) return false;
            used.add(item);
            nodes.push({ node, box, label: text, state: state(item) });
            return true;
        };
        if (!add(element, true)) return;
        const context = element.closest(panel);
        if (context) add(context, true);
        const walker = document.createTreeWalker(context || document.body, NodeFilter.SHOW_ELEMENT);
        for (let index = 0, item; index < maxScan && nodes.length < ${prototypeNodeLimit} && (item = walker.nextNode()); index++) {
            if (item.matches(candidates) || item.matches(panel)) add(item, item.matches(panel));
        }
        for (const { node } of nodes) {
            const item = find(node);
            if (native.length === 8) break;
            if (item?.matches('details[open]')) native.push({ node, control: 'details' });
            if (item?.matches('[popover]:popover-open')) native.push({ node, control: 'popover' });
        }
        return { nodes, native };
    }

    function boundedTextNodes(element) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_ALL);
        const items = [];
        for (let index = 0, node; index < maxScan && (node = walker.nextNode()); index++) {
            if (node.nodeType === Node.TEXT_NODE) items.push(node);
        }
        return items;
    }

    const normalizeQuote = value => value.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim();

    function readSelection() {
        const selected = window.getSelection();
        if (!selected?.rangeCount || selected.isCollapsed) return;
        const range = selected.getRangeAt(0);
        const root = range.commonAncestorContainer;
        const element = root instanceof Element ? root : root.parentElement;
        if (!element || !shown(element)) return;
        const nodes = boundedTextNodes(element);
        const offset = nodes.findIndex(text => range.intersectsNode(text));
        if (offset < 0) return;
        let endOffset = offset;
        while (endOffset + 1 < nodes.length && range.intersectsNode(nodes[endOffset + 1])) endOffset++;
        const start = nodes[offset] === range.startContainer ? range.startOffset : 0;
        const end = nodes[endOffset] === range.endContainer ? range.endOffset : nodes[endOffset].length;
        if (start > 4095 || end > 4096) return;
        let copy = '';
        for (let index = offset; index <= endOffset; index++) {
            const text = nodes[index];
            if (!shown(text.parentElement)) return;
            const length = (index === endOffset ? end : text.length) - (index === offset ? start : 0);
            if (copy.length + length > 500) return;
            copy += text.data.slice(index === offset ? start : 0, index === endOffset ? end : undefined);
        }
        const quote = normalizeQuote(copy);
        if (quote) return { element, selection: { quote, offset, endOffset, start, end } };
    }

    function clearOutline() {
        const selected = window.getSelection();
        if (restoredRange && selected?.rangeCount && selected.getRangeAt(0) === restoredRange) selected.removeAllRanges();
        restoredRange = undefined;
        if (!outline) return;
        outline.element.style.setProperty('outline', outline.value, outline.priority);
        outline = undefined;
    }

    function show(element) {
        clearOutline();
        outline = { element, value: element.style.getPropertyValue('outline'), priority: element.style.getPropertyPriority('outline') };
        element.style.setProperty('outline', '3px solid Highlight', 'important');
    }

    function pick(element, selected) {
        const target = describe(element);
        const captured = target && capture(element);
        if (!captured) { send('uncapturable'); return; }
        picking = false;
        selection = undefined;
        send('anchor', { target, capture: captured, selection: selected });
    }

    function restore(anchor, highlight) {
        for (const { node, control } of anchor.capture.native) {
            const item = find(node);
            if (control === 'details' && item?.matches('details')) item.open = true;
            if (control === 'popover' && item?.matches('[popover]:not(:popover-open)')) {
                try { item.showPopover(); } catch {}
            }
        }
        const element = find(anchor.target);
        if (!element || !anchor.capture.nodes.every(({ node, label: saved, state: savedState }) => {
            const item = find(node);
            return item && shown(item) && label(item) === saved && state(item) === savedState;
        })) return false;
        let range;
        if (anchor.selection) {
            const { offset, endOffset, start, end, quote } = anchor.selection;
            const nodes = boundedTextNodes(element);
            const first = nodes[offset];
            const last = nodes[endOffset];
            if (!first || !last || start > first.length || end > last.length) return false;
            const selected = nodes.slice(offset, endOffset + 1);
            let copy = '';
            for (const text of selected) {
                if (!shown(text.parentElement)) return false;
                const length = (text === last ? end : text.length) - (text === first ? start : 0);
                if (copy.length + length > 500) return false;
                copy += text.data.slice(text === first ? start : 0, text === last ? end : undefined);
            }
            if (normalizeQuote(copy) !== quote) return false;
            range = document.createRange();
            range.setStart(first, start);
            range.setEnd(last, end);
        }
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        if (highlight) show(element);
        if (range && highlight) {
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            restoredRange = range;
        }
        return true;
    }

    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.channel !== channel) return;
        if (event.data?.type === 'uier-proof:annotate') {
            picking = event.data.enabled === true;
            if (!picking) selection = undefined;
        }
        if (event.data?.type === 'uier-proof:use-selection' && picking) {
            const chosen = readSelection() || selection;
            if (chosen && shown(chosen.element)) pick(chosen.element, chosen.selection);
        }
        if (event.data?.type === 'uier-proof:restore') {
            clearOutline();
            const { anchor, request, highlight } = event.data;
            let restored = false;
            try { restored = Boolean(anchor && restore(anchor, highlight)); } catch {}
            send('restored', { request, restored });
        }
        if (event.data?.type === 'uier-proof:clear') clearOutline();
    });
    document.addEventListener('selectionchange', () => {
        if (picking) selection = readSelection() || selection;
    });
    window.addEventListener('click', event => {
        if (!picking || !event.isTrusted || !(event.target instanceof Element)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const chosen = readSelection();
        if (chosen) pick(chosen.element, chosen.selection);
        else pick(event.target.closest(candidates) || event.target, undefined);
    }, true);
    window.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (event.altKey && event.shiftKey && event.code === 'KeyA') {
            send('begin-pick');
            return;
        }
        if (!picking) return;
        if (event.key === 'Escape') {
            picking = false;
            selection = undefined;
            send('cancel');
        } else if (event.key === 'Enter' && event.target instanceof Element && event.target !== document.body) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const chosen = readSelection();
            if (chosen) pick(chosen.element, chosen.selection);
            else pick(event.target, undefined);
        }
    }, true);
    window.addEventListener('DOMContentLoaded', () => send('ready'), { once: true });
})();`;
