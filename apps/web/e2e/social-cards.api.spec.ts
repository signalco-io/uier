import { expect, test, type APIRequestContext } from '@playwright/test';
import { brand } from '@uier/brand';
import { KnownPageLinks, KnownPages } from '../src/knownPages';
import { integrationCatalog } from '../src/lib/integrations/catalog';
import { linkCardIds, socialCardSize } from '../src/lib/social/cards';

/** Every public page has an opengraph-image.tsx next to it (the landing page: app/opengraph-image.tsx) */
const publicPaths = [
    '/', '/brand', '/integrations',
    ...Object.keys(integrationCatalog).map(provider => `/integrations/${provider}`),
    '/legal/acceptable-use-policy', '/legal/cookie-policy', '/legal/privacy-policy',
    '/legal/sla', '/legal/terms-of-service', '/open-source', '/security', '/status'
];

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
    /** The path of an image (absolute on uier.io through metadataBase; route cards add a version query) */
    const image = (key: string) => {
        const url = meta(key);
        return url ? new URL(url).pathname : undefined;
    };
    return { path: new URL(response.url()).pathname, title: decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''), meta, image };
}

async function expectCard(request: APIRequestContext, path: string) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toBe('image/png');
    const png = await response.body();
    // The IHDR chunk: width and height at bytes 16 and 20
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([socialCardSize.width, socialCardSize.height]);
}

test('public pages are previewed with a card of their own', async ({ request }) => {
    for (const path of publicPaths) {
        const page = await preview(request, path);
        // Next adds a suffix to the card's address inside a route group
        const card = page.image('og:image');
        expect(card, path).toMatch(new RegExp(`^${path === '/' ? '' : path}/opengraph-image(-\\w+)?$`));
        expect(page.image('twitter:image'), path).toBe(card);
        expect(page.meta('og:image:width'), path).toBe(String(socialCardSize.width));
        expect(page.meta('og:image:height'), path).toBe(String(socialCardSize.height));
        expect(page.meta('og:site_name'), path).toBe(brand.name);
        expect(page.meta('twitter:card'), path).toBe('summary_large_image');
        // The card shows the page's own title (an integration's comes from the catalog, like its page)
        if (!path.startsWith(`${KnownPages.Integrations}/`))
            expect(page.meta('og:image:alt'), path).toBe(page.meta('og:title'));
        await expectCard(request, card!);
    }
});

test('link cards are static PNGs and nothing else is served there', async ({ request }) => {
    for (const card of linkCardIds)
        await expectCard(request, KnownPageLinks.socialCard(card));
    expect((await request.get(KnownPageLinks.socialCard('unknown'))).status()).toBe(404);
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
