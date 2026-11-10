import type { PageFixture } from './types';

// The site view of the page checks (e2e/page-checks-site.spec.ts): every page keeps the reviewed site's
// title ("Reviewed site"), so any two pages share it. `/pricing` and `/plans` also share a meta
// description, and `/private` asks search engines not to index it.

const sharedDescription = 'Plans and prices for teams that review their sites with comments on the page.';

const fixture: PageFixture = {
    head: url => {
        if (/\/(?:pricing|plans)$/.test(url.pathname)) return `<meta name="description" content="${sharedDescription}">`;
        if (/\/private$/.test(url.pathname)) return '<meta name="robots" content="noindex">';
        return '';
    }
};

export default fixture;
