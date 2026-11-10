import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * What a test adds to the reviewed site (`reviewedSite.ts`) on its own origin,
 * `site.origin('fixture-<name>')`: every page there gets it, so a spec needs no change to the shared
 * server. One file per area in this folder, listed in `index.ts`.
 */
export type PageFixture = {
    /** Added to the page's `<head>` */
    head?: (url: URL) => string;
    /** Added to the page's `<main>`, after its h1 and first paragraph */
    body?: (url: URL) => string;
    /** The whole page instead (its complete HTML, with `embed`, the toolbar's script tag, in it); nothing for the usual page */
    page?: (url: URL, embed: string) => string | undefined;
    /** Added to `/host.css` */
    css?: string;
    /** More response headers of the page (`X-Robots-Tag`) */
    headers?: (url: URL) => Record<string, string>;
    /** The page's Content-Security-Policy, from the install guide's */
    csp?: (policy: string, url: URL) => string;
    /** The site's other addresses (`/robots.txt`, an image): true when it answered */
    route?: (url: URL, request: IncomingMessage, response: ServerResponse) => boolean;
};
