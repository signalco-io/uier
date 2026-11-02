import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { pageCards, socialCard, socialCardAlt, socialCardSize, type LinkCardId, type PageCardId, type SocialCardId } from './cards';

/**
 * Open Graph fields every page shares. Titles and descriptions are left out on purpose: Next fills
 * them in from each page's own `title` and `description`, and X's from Open Graph.
 */
export const siteOpenGraph = { type: 'website', siteName: brand.name } as const;

function cardImage(id: SocialCardId) {
    return { url: KnownPageLinks.socialCard(id), ...socialCardSize, alt: socialCardAlt(socialCard(id)), type: 'image/png' };
}

/** A public page's title, description and social card, from `pageCards` */
export function pageMetadata(id: PageCardId): Metadata {
    const { title, description } = pageCards[id];
    return { title, description, openGraph: { ...siteOpenGraph, images: [cardImage(id)] } };
}

/** How a link into the app is previewed: what kind of link it is, never what is behind it */
export type AppLink = { card: LinkCardId; title: string; description: string };

/** The preview of a link into the app; the page keeps its own title in the browser */
export function appLinkMetadata({ card, title, description }: AppLink): Metadata {
    return { openGraph: { ...siteOpenGraph, title, description, images: [cardImage(card)] } };
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
