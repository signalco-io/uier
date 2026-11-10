// Screen reader outline (packages/toolbar/docs/page-checks-keyboard.md): what a screen reader user
// navigates by, in reading order: landmarks, headings and controls with their roles, accessible names
// and states, from axe-core's own role and name functions on its virtual tree. Plain data and page
// elements only.
import type { AxeApi } from '../auditHandoff';
import { elementKey, foundLine, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import type { PageCheck, PageIssue } from '../types';
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

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a screen reader says about a control's state */
function statesOf(element: Element, role: string) {
    const states: string[] = [];
    const aria = (name: string) => element.getAttribute(`aria-${name}`);
    const details = element.localName === 'summary' ? element.parentElement : null;
    const expanded = aria('expanded') ?? (details instanceof HTMLDetailsElement ? String(details.open) : null);
    if (expanded === 'true' || expanded === 'false') states.push(expanded === 'true' ? 'expanded' : 'collapsed');
    const pressed = aria('pressed');
    if (pressed === 'true' || pressed === 'mixed') states.push(pressed === 'true' ? 'pressed' : 'partly pressed');
    else if (pressed === 'false') states.push('not pressed');
    if (checkable.includes(role)) {
        const input = element instanceof HTMLInputElement && /^(checkbox|radio)$/.test(element.type) ? element : undefined;
        const checked = input ? input.indeterminate ? 'mixed' : String(input.checked) : aria('checked') ?? 'false';
        states.push(checked === 'true' ? 'checked' : checked === 'mixed' ? 'partly checked' : 'not checked');
    }
    if ((/^(input|select|textarea)$/.test(element.localName) && element.hasAttribute('required')) || aria('required') === 'true') states.push('required');
    const invalid = aria('invalid');
    if (invalid && invalid !== 'false') states.push('invalid');
    if (element.matches(':disabled') || aria('disabled') === 'true') states.push('disabled');
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
    if (!found.length) {
        return pageCheck('sr-same-name', 'Links and buttons with one name', 'pass', shared.length
            ? 'Links and buttons that share a name lead to the same place.' : 'Every link and button has a name of its own.');
    }
    const issues: PageIssue[] = found.flatMap(({ link, items }) => items.map(item => {
        const address = writtenAddress(item.element.getAttribute('href'));
        return pageIssue(path, { type: 'accessibility', id: 'sr-same-name' }, item.element, link ? `Named "${item.name}", goes to ${address}` : `Named "${item.name}"`,
            `Accessibility: ${items.length} ${link ? 'links' : 'buttons'} on this page share this name but ${link ? 'go to different addresses' : 'act on different things (their list items, rows or controlled elements differ)'}. Listed by name, as screen readers offer them, they cannot be told apart. Give each a name that says ${link ? 'where it goes' : 'what it does'}.`
            + `${foundLine(link ? 'Link text' : 'Button text', item.name)}${link ? foundLine('Address', address) : ''}`);
    }));
    const [first] = found;
    const more = found.length > 1 ? ` ${count(found.length - 1, 'more name')} ${found.length > 2 ? 'are' : 'is'} shared the same way.` : '';
    return pageCheck('sr-same-name', 'Links and buttons with one name', 'warn',
        `${first!.items.length} ${first!.link ? 'links are' : 'buttons are'} named "${first!.items[0]!.name}" but ${first!.link ? 'go to different addresses' : 'act on different things'}.${more}`, { issues });
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
    const checks = [
        pageCheck('sr-landmarks', 'Landmarks', 'none', roles.length ? `${roles.join(', ')}.` : 'None on this page.', { measure: String(landmarkItems.length) }),
        pageCheck('sr-headings', 'Headings', 'none', levels.length
            ? `Levels ${Math.min(...levels)} to ${Math.max(...levels)}.`.replace(/Levels (\d) to \1\./, 'Level $1.') : 'None on this page.', { measure: String(levels.length) }),
        pageCheck('sr-controls', 'Controls', 'none', controls.length
            ? `${count(links, 'link')}, ${count(buttons, 'button')} and ${count(controls.length - links - buttons, 'other control')} (form fields, tabs, menu items).`
            : 'None on this page.', { measure: String(controls.length) }),
        sameNameCheck(path, controls)
    ];
    return { checks, note: 'In reading order', details: { structure, controls } };
}
