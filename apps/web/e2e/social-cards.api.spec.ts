import { expect, test, type APIRequestContext } from '@playwright/test';
import { brand } from '@uier/brand';
import { KnownPageLinks, KnownPages } from '../src/knownPages';
import { pageCards, socialCardIds, socialCardSize } from '../src/lib/social/cards';

function decode(value: string) {
    return value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The page a link preview sees (signed out, after redirects): its title and meta tags */
async function preview(request: APIRequestContext, path: string) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const meta = (key: string) => {
        const match = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
        return match ? decode(match[1]!) : undefined;
    };
    /** The path of an image (absolute on uier.io through metadataBase) */
    const image = (key: string) => {
        const url = meta(key);
        return url ? new URL(url).pathname : undefined;
    };
    return { path: new URL(response.url()).pathname, title: decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''), meta, image };
}

test('every social card is a 1200 × 630 PNG', async ({ request }) => {
    for (const path of ['/opengraph-image', ...socialCardIds.map(KnownPageLinks.socialCard)]) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(200);
        expect(response.headers()['content-type'], path).toBe('image/png');
        const png = await response.body();
        // The IHDR chunk: width and height at bytes 16 and 20
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([socialCardSize.width, socialCardSize.height]);
    }
    expect((await request.get(KnownPageLinks.socialCard('unknown'))).status()).toBe(404);
});

test('the landing page is previewed with the brand card', async ({ request }) => {
    const page = await preview(request, KnownPages.Landing);
    expect(page.meta('og:title')).toBe(`${brand.name} · ${brand.tagline}`);
    expect(page.meta('og:description')).toBe(brand.shortDescription);
    expect(page.meta('og:site_name')).toBe(brand.name);
    expect(page.image('og:image')).toBe('/opengraph-image');
    expect(page.meta('twitter:card')).toBe('summary_large_image');
});

test('public pages are previewed with their own title, description and card', async ({ request }) => {
    for (const [id, card] of Object.entries(pageCards)) {
        const page = await preview(request, card.path);
        const title = `${card.title} · ${brand.name}`;
        expect(page.title, card.path).toBe(title);
        expect(page.meta('og:title'), card.path).toBe(title);
        expect(page.meta('og:description'), card.path).toBe(card.description);
        expect(page.meta('og:site_name'), card.path).toBe(brand.name);
        // Not the landing page's address: platforms would merge every page into it
        expect(page.meta('og:url'), card.path).toBeUndefined();
        expect(page.image('og:image'), card.path).toBe(KnownPageLinks.socialCard(id));
        expect(page.meta('og:image:width'), card.path).toBe(String(socialCardSize.width));
        expect(page.meta('og:image:alt'), card.path).toBe(title);
        expect(page.meta('twitter:card'), card.path).toBe('summary_large_image');
        expect(page.meta('twitter:title'), card.path).toBe(title);
        expect(page.image('twitter:image'), card.path).toBe(KnownPageLinks.socialCard(id));
    }
});

test('links into the app are previewed signed out by their kind, without their content', async ({ request }) => {
    const site = 'https://shop.example.com/menu?table=4';
    const cases = [
        { link: KnownPageLinks.projectReview('preview-project', site, 'preview-comment'), title: 'Comment on shop.example.com', card: 'comment' },
        { link: KnownPageLinks.projectReview('preview-project', site), title: 'Review shop.example.com', card: 'review' },
        // Only a plain web address names the site
        { link: KnownPageLinks.projectReview('preview-project', 'javascript:alert(1)', 'preview-comment'), title: 'Comment', card: 'comment' },
        { link: KnownPageLinks.project('preview-project'), title: `Project on ${brand.name}`, card: 'sign-in' },
        { link: KnownPages.AppSignIn, title: `Sign in to ${brand.name}`, card: 'sign-in' }
    ];
    for (const { link, title, card } of cases) {
        const page = await preview(request, link);
        expect(page.path, link).toBe(KnownPages.AppSignIn);
        expect(page.title, link).toBe(`Sign in · ${brand.name}`);
        expect(page.meta('og:title'), link).toBe(title);
        expect(page.meta('twitter:title'), link).toBe(title);
        expect(page.meta('og:description'), link).toMatch(/^Sign in to /);
        expect(page.image('og:image'), link).toBe(KnownPageLinks.socialCard(card));
        expect(page.image('twitter:image'), link).toBe(KnownPageLinks.socialCard(card));
    }

    const invitation = await preview(request, `${KnownPages.AppInvitation}?token=preview-token`);
    expect(invitation.title).toBe(`Invitation · ${brand.name}`);
    expect(invitation.meta('og:title')).toBe(`You are invited to ${brand.name}`);
    expect(invitation.image('og:image')).toBe(KnownPageLinks.socialCard('invitation'));
});

test('robots.txt lets link previews reach the app links that end at sign in', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    for (const path of [KnownPages.AppReview, KnownPages.AppProjects].map(path => `${path}/`).concat(KnownPages.AppSignIn, KnownPages.AppInvitation))
        expect(robots).toContain(`Allow: ${path}\n`);
    expect(robots).toContain(`Disallow: ${KnownPages.App}\n`);
});
