/** Contract v1. Kept independent of the browser and server; both reject arbitrary fetch routes. */
export type ExtensionMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const id = '[A-Za-z0-9_-]{1,72}';
const operations: [RegExp, ExtensionMethod[]][] = [
    [/^$/, ['GET']], [/^comments$/, ['GET', 'POST']], [/^comments\/activity$/, ['GET']],
    [/^comments\/read$/, ['POST']], [/^participants$/, ['GET']], [/^rewrite$/, ['POST']],
    [/^notifications$/, ['POST']],
    [new RegExp(`^comments/${id}$`), ['PATCH', 'DELETE']],
    [new RegExp(`^comments/${id}/replies$`), ['POST']],
    [new RegExp(`^comments/${id}/replies/${id}$`), ['PATCH', 'DELETE']],
    [new RegExp(`^comments/${id}/(assignee|anchor)$`), ['PATCH']],
    [new RegExp(`^comments/${id}/screenshot$`), ['GET', 'POST']],
    [new RegExp(`^comments/${id}/context$`), ['GET']],
    [new RegExp(`^comments/${id}/read$`), ['POST', 'DELETE']],
    [new RegExp(`^comments/${id}/notifications$`), ['GET', 'POST']]
];
export function allowedExtensionOperation(path: string, method: unknown): method is ExtensionMethod {
    return operations.some(([pattern, methods]) => pattern.test(path) && methods.includes(method as ExtensionMethod));
}
export function extensionOperation(url: string, apiOrigin: string, publicId: string, method: unknown) {
    const target = new URL(url);
    const prefix = `/api/review/${publicId}`;
    if (target.origin !== apiOrigin || target.username || target.password || target.hash
        || (target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`))) throw new Error('Invalid review operation');
    const path = target.pathname.slice(prefix.length).replace(/^\//, '');
    if (!allowedExtensionOperation(path, method)) throw new Error('Unsupported review operation');
    if (target.search.length > 4096) throw new Error('Review query is too long');
    for (const key of target.searchParams.keys()) {
        if (!['path', 'scope', 'unread', 'environment', 'commentId'].includes(key)) throw new Error('Unsupported review query');
    }
    return { path, query: target.search };
}
