import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { linkCardAlt, linkCards, socialCardContentType, socialCardSize, type LinkCardId } from '@/src/lib/social/cards';

/** Open Graph fields every page shares; each page adds its own title, description and card. */
export const siteOpenGraph = { type: 'website', siteName: brand.name } as const;

/** The brand card, `app/opengraph-image.tsx` */
const brandCard = { url: '/opengraph-image', ...socialCardSize, alt: `${brand.name} · ${brand.tagline}`, type: socialCardContentType };

/**
 * Public pages declare their own URL so queries and alternate hosts share one canonical. A page
 * with a title draws its social card in the `opengraph-image.tsx` next to it (`pageCardImage`),
 * which Next adds here because `images` is not set. Without a title the page speaks for the whole
 * site (the landing page) and gets the brand card: the root image file is not inherited once a
 * page sets its own Open Graph.
 */
export function publicPageMetadata(path: string, { title, description = brand.shortDescription }: {
    title?: string;
    description?: string;
} = {}): Metadata {
    const socialTitle = title ? `${title} · ${brand.name}` : `${brand.name} · ${brand.tagline}`;
    const canonical = new URL(path, brand.url).href;
    return {
        ...(title ? { title } : {}),
        description,
        alternates: { canonical },
        openGraph: {
            ...siteOpenGraph,
            title: socialTitle,
            description,
            url: canonical,
            ...(title ? {} : { images: [brandCard] })
        },
        twitter: { card: 'summary_large_image', title: socialTitle, description, ...(title ? {} : { images: [brandCard] }) }
    };
}

/** How a link into the app is previewed: what kind of link it is, never what is behind it */
export type AppLink = { card: LinkCardId; title: string; description: string };

/** The preview of a link into the app; the page keeps its own title in the browser */
export function appLinkMetadata({ card, title, description }: AppLink): Metadata {
    const image = { url: KnownPageLinks.socialCard(card), ...socialCardSize, alt: linkCardAlt(linkCards[card]), type: socialCardContentType };
    return {
        openGraph: { ...siteOpenGraph, title, description, images: [image] },
        twitter: { card: 'summary_large_image', title, description, images: [image] }
    };
}

export const invitationLink: AppLink = {
    card: 'invitation',
    title: `You are invited to ${brand.name}`,
    description: 'Accept the invitation to sign in and review sites with your team.'
};

/** The reviewed site's host in a review link's `url`, when that is a plain web address */
function reviewedHost(value: string | null) {
    if (!value) return undefined;
    try {
        const { protocol, hostname } = new URL(value);
        // URL lowercases the host and turns international names into punycode, so this also
        // keeps look-alike characters out of the preview.
        return (protocol === 'https:' || protocol === 'http:') && /^[a-z0-9.-]{1,64}$/.test(hostname) ? hostname : undefined;
    } catch { return undefined; }
}

/**
 * What a shared link into the app is, from the address sign-in returns to (`?next=`, already
 * checked by `safeNextPath`). Link previews are fetched signed out, so comment and review links
 * arrive at sign in. Only the link is used: the site's host comes from the review link's own `url`
 * parameter, and nothing is read from the store, so a preview shows no project or comment.
 */
export function describeAppLink(next: string | undefined): AppLink {
    const url = next ? new URL(next, brand.url) : undefined;
    if (url?.pathname.startsWith(`${KnownPages.AppReview}/`)) {
        const host = reviewedHost(url.searchParams.get('url'));
        return url.searchParams.get('comment')
            ? { card: 'comment', title: host ? `Comment on ${host}` : 'Comment', description: 'Sign in to open this comment on the page it is about.' }
            : { card: 'review', title: host ? `Review ${host}` : 'Review link', description: `Sign in to open the site with the ${brand.name} toolbar and comment on the page.` };
    }
    if (url?.pathname.startsWith(`${KnownPages.AppProjects}/`) && url.pathname !== KnownPages.AppNewProject)
        return { card: 'sign-in', title: `Project on ${brand.name}`, description: 'Sign in to see the comments on this project.' };
    return { card: 'sign-in', title: `Sign in to ${brand.name}`, description: 'Sign in to see your projects and the comments left on their pages.' };
}
