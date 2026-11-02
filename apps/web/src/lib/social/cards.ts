import { brand } from '@uier/brand';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';

// What the social cards (Open Graph and X images) say. Public pages draw theirs in an
// `opengraph-image.tsx` next to the page (`pageCardImage`); links into the app use the static
// cards below, served by `app/og/[card]/route.ts`. Both are drawn by `SocialCard.tsx`.

/** 1200 × 630, the size every platform crops the least (BRAND.md, "Marketing and metadata") */
export const socialCardSize = { width: 1200, height: 630 } as const;
export const socialCardContentType = 'image/png';

/** A public page's card: the page's own title and description, and its address */
export type PageCard = {
    title: string;
    description: string;
    path: string;
    /** The part of the site, top right (Legal, Features) */
    section?: string;
    /** An integration's page shows the service's logo instead of a section */
    provider?: IntegrationProviderId;
};

/** The alt text of a page card, which is also the page's social title */
export function pageCardAlt(card: PageCard) {
    return `${card.title} · ${brand.name}`;
}

/**
 * A link into the app (a comment, a review link, an invitation). Previews are fetched signed out,
 * so these never show what is behind the link: only what kind of link it is.
 */
export type LinkCard = {
    picture: 'comment' | 'review' | 'invitation' | 'app';
    section: string;
    title: string;
    description: string;
};

export const linkCards = {
    comment: {
        picture: 'comment', section: 'Comment', title: 'Open the comment on the page',
        description: 'It stays pinned to the element it is about, on the live site.'
    },
    review: {
        picture: 'review', section: 'Review link', title: 'Review the live site',
        description: 'Open the site with the toolbar and leave comments directly on the page.'
    },
    invitation: {
        picture: 'invitation', section: 'Invitation', title: 'You are invited',
        description: 'Accept the invitation to sign in and review sites with your team.'
    },
    'sign-in': {
        picture: 'app', section: 'App', title: `Continue in ${brand.name}`,
        description: 'Sign in to see your projects and the comments left on their pages.'
    }
} satisfies Record<string, LinkCard>;

export type LinkCardId = keyof typeof linkCards;

export const linkCardIds = Object.keys(linkCards) as LinkCardId[];

export function isLinkCardId(value: string): value is LinkCardId {
    return Object.hasOwn(linkCards, value);
}

export function linkCardAlt(card: LinkCard) {
    return `${card.section} · ${card.title}`;
}
