import type { PageFixture } from './types';

// A finding's thread runs its check again (packages/toolbar/docs/page-checks-verify.md): an image
// without alt text (accessibility `image-alt`), a script link (SEO `link-address`) and no meta
// description (SEO `description`). `?fixed` is the same page (the same comments) with all three fixed.

/** A 1 × 1 PNG, allowed by `img-src data:` */
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const fixture: PageFixture = {
    head: url => url.searchParams.has('fixed')
        ? '<meta name="description" content="Plans and prices of the reviewed site, with what every plan includes and how to choose one.">'
        : '',
    body: url => {
        const fixed = url.searchParams.has('fixed');
        return `<section id="verify-findings">
            <h2>Plans in detail</h2>
            <img id="verify-chart" src="${image}" width="48" height="48"${fixed ? ' alt="Plan comparison chart"' : ''}>
            <p><a id="verify-link" href="${fixed ? '/plans' : 'javascript:void(0)'}">Compare plans</a></p>
        </section>`;
    }
};

export default fixture;
