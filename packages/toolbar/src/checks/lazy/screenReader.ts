// Screen reader outline (packages/toolbar/docs/page-checks-keyboard.md): what a screen reader user
// navigates by, in reading order: landmarks, headings and controls with their roles, accessible names
// and states, from axe-core's own role and name functions on its virtual tree. Plain data and page
// elements only.
import type { AxeApi } from '../auditHandoff';
import { elementKey, foundLine, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import type { PageCheck, PageIssue } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

export type OutlineItem = {
    key: string;
    role: string;
    /** The accessible name, empty without one */
    name: string;
    /** A heading's level */
    level?: number;
    /** expanded, pressed, checked, required, invalid... */
    states: string[];
    /** How many landmarks it is in */
    depth: number;
    element: Element;
};

export type ScreenReaderDetails = {
    /** Landmarks and headings, in reading order */
    structure: OutlineItem[];
    /** Links, buttons and form fields, in reading order */
    controls: OutlineItem[];
};

/** The parts of axe-core's virtual tree and helpers this uses (axe-core 4.14; not all in its types) */
type VirtualNode = { actualNode?: Node; children?: VirtualNode[]; props: { nodeType: number; nodeName: string } };
type AxeHelpers = {
    commons: {
        aria: { getRole(node: VirtualNode, options?: { noPresentational?: boolean }): string | null };
        text: { accessibleTextVirtual(node: VirtualNode): string };
        dom: { isVisibleToScreenReaders(node: VirtualNode): boolean };
    };
};

const landmarks = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'region', 'form'];
const controlRoles = ['link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider',
    'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio'];
const checkable = ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'];

/** What a screen reader says about a control's state, in the toolbar's language */
function statesOf(element: Element, role: string) {
    const said = words().screenReader.states;
    const states: string[] = [];
    const aria = (name: string) => element.getAttribute(`aria-${name}`);
    const details = element.localName === 'summary' ? element.parentElement : null;
    const expanded = aria('expanded') ?? (details instanceof HTMLDetailsElement ? String(details.open) : null);
    if (expanded === 'true' || expanded === 'false') states.push(expanded === 'true' ? said.expanded : said.collapsed);
    const pressed = aria('pressed');
    if (pressed === 'true' || pressed === 'mixed') states.push(pressed === 'true' ? said.pressed : said.partlyPressed);
    else if (pressed === 'false') states.push(said.notPressed);
    if (checkable.includes(role)) {
        const input = element instanceof HTMLInputElement && /^(checkbox|radio)$/.test(element.type) ? element : undefined;
        const checked = input ? input.indeterminate ? 'mixed' : String(input.checked) : aria('checked') ?? 'false';
        states.push(checked === 'true' ? said.checked : checked === 'mixed' ? said.partlyChecked : said.notChecked);
    }
    if ((/^(input|select|textarea)$/.test(element.localName) && element.hasAttribute('required')) || aria('required') === 'true') states.push(said.required);
    const invalid = aria('invalid');
    if (invalid && invalid !== 'false') states.push(said.invalid);
    if (element.matches(':disabled') || aria('disabled') === 'true') states.push(said.disabled);
    return states;
}

/** Where a link goes, the same for the same page (no trailing slash difference) */
function destination(element: Element) {
    const href = (element as HTMLAnchorElement).href;
    if (typeof href !== 'string' || !href) return undefined;
    try {
        const url = new URL(href);
        return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}${url.hash}`;
    } catch {
        return undefined;
    }
}

/**
 * What a button acts on, as far as the page says: the element it controls, else the list item, row
 * or article it is in (an "Add to cart" per product), else its form and value; the same for buttons
 * that say none of these
 */
function target(element: Element) {
    const controls = element.getAttribute('aria-controls');
    if (controls) return `controls:${controls}`;
    const item = element.closest('li, tr, article, [role="listitem"], [role="row"], [role="article"]');
    if (item) return `item:${elementKey(item)}`;
    const button = element as HTMLButtonElement;
    return button.form ? `form:${elementKey(button.form)}:${button.formAction}:${button.name}:${button.value}` : 'page';
}

/** Several links or buttons with one name that go to different addresses or act on different things */
function sameNameCheck(path: string, controls: OutlineItem[]): PageCheck {
    const groups = new Map<string, OutlineItem[]>();
    for (const item of controls) {
        // A description (read after the name) can tell them apart
        if ((item.role !== 'link' && item.role !== 'button') || !item.name
            || item.element.hasAttribute('aria-describedby') || item.element.hasAttribute('aria-description')) continue;
        const key = `${item.role}:${item.name.toLowerCase()}`;
        groups.set(key, [...groups.get(key) ?? [], item]);
    }
    const shared = [...groups.values()].filter(group => group.length > 1);
    const found = shared.flatMap(group => {
        const link = group[0]!.role === 'link';
        const known = link ? group.filter(item => destination(item.element)) : group;
        const ends = new Set(known.map(item => link ? destination(item.element) : target(item.element)));
        return ends.size > 1 ? [{ link, items: known }] : [];
    });
    const { screenReader: t, found: names } = words();
    if (!found.length) {
        return pageCheck('sr-same-name', t.sameName, 'pass', shared.length ? t.sameNameShared : t.sameNameOwn);
    }
    const issues: PageIssue[] = found.flatMap(({ link, items }) => items.map(item => {
        const address = writtenAddress(item.element.getAttribute('href'));
        return pageIssue(path, { type: 'accessibility', id: 'sr-same-name' }, item.element, link ? t.namedLink(item.name, address) : t.named(item.name),
            t.sameNameComment(items.length, link)
            + `${foundLine(link ? names.linkText : names.buttonText, item.name)}${link ? foundLine(names.address, address) : ''}`);
    }));
    const [first] = found;
    const more = found.length > 1 ? t.moreShared(found.length - 1) : '';
    return pageCheck('sr-same-name', t.sameName, 'warn',
        `${t.sameNameFound(first!.items.length, first!.link, first!.items[0]!.name)}${more}`, { issues });
}

/**
 * The page's landmarks, headings and controls in reading order (the flat tree: open shadow roots in
 * place), each with axe-core's role and accessible name, skipping what screen readers do not get
 * (`aria-hidden`, hidden) and the toolbar. axe-core's virtual tree is set up for it and torn down
 * after, also when it fails: call it inside `withAxe`, since axe-core does one thing at a time.
 */
export function screenReaderOutline(axe: AxeApi, { path }: SectionContext): SectionReport<ScreenReaderDetails> {
    const { aria, text, dom } = (axe as unknown as AxeHelpers).commons;
    const structure: OutlineItem[] = [];
    const controls: OutlineItem[] = [];
    const root = axe.setup(document) as unknown as VirtualNode;
    try {
        const walk = (node: VirtualNode, depth: number) => {
            for (const child of node.children ?? []) {
                const element = child.actualNode;
                if (child.props.nodeType !== 1 || !(element instanceof Element) || child.props.nodeName === 'head') continue;
                if ((element.shadowRoot || element.hasAttribute('data-uier-thread')) && isToolbarNode(element)) continue;
                let inner = depth;
                let role: string | null = null;
                try {
                    role = aria.getRole(child, { noPresentational: true });
                } catch { /* A role axe-core cannot resolve here: none */ }
                const kind = role && (landmarks.includes(role) ? 'landmark' : role === 'heading' ? 'heading' : controlRoles.includes(role) ? 'control' : undefined);
                if (role && kind && dom.isVisibleToScreenReaders(child)) {
                    const name = oneLine(text.accessibleTextVirtual(child), 150);
                    // A region or a form is a landmark only with a name
                    if (kind !== 'landmark' || name || (role !== 'region' && role !== 'form')) {
                        const level = Number.parseInt(element.getAttribute('aria-level') ?? '', 10);
                        const item: OutlineItem = {
                            key: `sr:${elementKey(element)}`, role, name, depth, element,
                            level: kind === 'heading' ? level > 0 ? level : Number(/^h([1-6])$/.exec(element.localName)?.[1] ?? 2) : undefined,
                            states: kind === 'control' ? statesOf(element, role) : []
                        };
                        (kind === 'control' ? controls : structure).push(item);
                        if (kind === 'landmark') inner++;
                    }
                }
                walk(child, inner);
            }
        };
        walk(root, 0);
    } finally {
        axe.teardown();
    }
    const landmarkItems = structure.filter(item => item.level === undefined);
    const headings = structure.filter(item => item.level !== undefined);
    const roles = [...new Set(landmarkItems.map(item => item.role))].map(role => {
        const n = landmarkItems.filter(item => item.role === role).length;
        return n > 1 ? `${role} (${n})` : role;
    });
    const levels = headings.map(item => item.level!);
    const links = controls.filter(item => item.role === 'link').length;
    const buttons = controls.filter(item => item.role === 'button').length;
    const t = words().screenReader;
    const checks = [
        pageCheck('sr-landmarks', t.landmarks, 'none', roles.length ? `${roles.join(', ')}.` : t.none, { measure: String(landmarkItems.length) }),
        pageCheck('sr-headings', t.headings, 'none', levels.length
            ? t.levels(Math.min(...levels), Math.max(...levels)) : t.none, { measure: String(levels.length) }),
        pageCheck('sr-controls', t.controls, 'none', controls.length
            ? t.controlCounts(links, buttons, controls.length - links - buttons)
            : t.none, { measure: String(controls.length) }),
        sameNameCheck(path, controls)
    ];
    return { checks, note: t.note, details: { structure, controls } };
}
