// Page addresses as a hierarchy (the Page checks view's lists across pages, uier #219): each path
// segment is a level and a query is a level under its path, so `/cms/products?lang=sq-AL` sits under
// `/cms/products`, which sits under `/cms`. Pure, so the API tests check it.

/** One level of the hierarchy: a page when `item` is set, otherwise only a part of its pages' addresses */
export type PathNode<T> = {
    /** The address this level stands for, like `/cms/products` or `/cms/products?lang=` */
    path: string;
    /** The address of the level above it, `''` at the top; `path` starts with it */
    base: string;
    item?: T;
    children: PathNode<T>[];
};

/** The levels of an address: one per path segment, then its query (and fragment) as the last */
function levels(path: string) {
    const split = path.search(/[?#]/);
    const pathname = split < 0 ? path : path.slice(0, split);
    const query = split < 0 ? '' : path.slice(split);
    // Keep unusual paths exact: empty segments distinguish /a//b from /a/b.
    if (pathname.includes('//') || (pathname.length > 1 && pathname.endsWith('/'))) return [path];
    const segments = pathname.split('/').filter(Boolean);
    const keys = segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);
    if (!keys.length) keys.push('/');
    if (query) keys.push(`${keys.at(-1)}${query}`);
    return keys;
}

/**
 * The items as a hierarchy of their addresses, in the order they come. A level that is not a page
 * and holds one level only is merged into it (`/destinations/coolinarika/daily-menus`), so a chain of
 * empty levels takes one line. An address that is not a path (no leading slash) stays at the top.
 */
export function pathTree<T>(items: readonly T[], pathOf: (item: T) => string): PathNode<T>[] {
    const roots: PathNode<T>[] = [];
    const nodes = new Map<string, PathNode<T>>();
    for (const item of items) {
        const path = pathOf(item);
        let siblings = roots;
        let base = '';
        const keys = path.startsWith('/') ? levels(path) : [path];
        for (const key of keys) {
            let node = nodes.get(key);
            if (!node) {
                node = { path: key, base, children: [] };
                nodes.set(key, node);
                siblings.push(node);
            }
            siblings = node.children;
            base = key;
        }
        // The same address twice: the first keeps the level
        nodes.get(keys.at(-1)!)!.item ??= item;
    }
    return merge(roots);
}

function merge<T>(nodes: PathNode<T>[]): PathNode<T>[] {
    return nodes.map(node => {
        let current = node;
        while (current.item === undefined && current.children.length === 1) current = current.children[0]!;
        return { ...current, base: node.base, children: merge(current.children) };
    });
}
