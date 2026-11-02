import { brand } from '@uier/brand';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { integrationCatalog, type IntegrationCatalogKey } from '@/src/lib/integrations/catalog';

// The social cards (Open Graph and X images) of uier.io's links, rendered at build time by
// `app/og/[card]/route.ts` (`SocialCard.tsx`). The landing page keeps the brand card,
// `app/opengraph-image.tsx`. Public pages take their title and description from here, so the
// page, its link preview and its card say the same thing.

/** 1200 × 630, the size every platform crops the least (BRAND.md, "Marketing and metadata") */
export const socialCardSize = { width: 1200, height: 630 } as const;

/** A public page: its title and description, as the page and its card show them */
export type PageCard = {
    kind: 'page';
    title: string;
    description: string;
    path: string;
    /** The part of the site, above the title (legal documents, integrations) */
    section?: string;
    /** An integration's page shows the service's logo */
    provider?: IntegrationCatalogKey;
};

/**
 * A link into the app (a comment, a review link, an invitation). Previews are fetched signed out,
 * so these never show what is behind the link: only what kind of link it is.
 */
export type LinkCard = {
    kind: 'link';
    picture: 'comment' | 'review' | 'invitation' | 'app';
    section: string;
    title: string;
    description: string;
};

export type SocialCard = PageCard | LinkCard;

const integrationCards = Object.fromEntries(Object.entries(integrationCatalog).map(([provider, integration]) => [
    `integration-${provider}`,
    {
        kind: 'page', section: 'Integrations', title: integration.title, description: integration.description,
        path: KnownPageLinks.integration(provider), provider: provider as IntegrationCatalogKey
    } satisfies PageCard
])) as Record<`integration-${IntegrationCatalogKey}`, PageCard>;

export const pageCards = {
    brand: {
        kind: 'page', title: 'Brand', path: KnownPages.Brand,
        description: `How ${brand.name} looks and sounds: logo, colour, type, shape and the review layer.`
    },
    integrations: {
        kind: 'page', title: 'Integrations', path: KnownPages.Integrations,
        description: 'Connect website feedback to Notion, GitHub, Linear, Azure DevOps and Slack.'
    },
    ...integrationCards,
    security: {
        kind: 'page', title: 'Security', path: KnownPages.Security,
        description: `How ${brand.domain} protects the comments left on it, and how to report a vulnerability.`
    },
    'open-source': {
        kind: 'page', title: 'Open source', path: KnownPages.OpenSource,
        description: `${brand.name} is open source: the website, the comments API, the toolbar, the brand and the infrastructure are in one public repository.`
    },
    status: {
        kind: 'page', title: 'Status', path: KnownPages.Status,
        description: `Live checks of ${brand.name}'s website and comments.`
    },
    'privacy-policy': {
        kind: 'page', section: 'Legal', title: 'Privacy policy', path: KnownPages.LegalPrivacyPolicy,
        description: `What ${brand.domain} collects, why, where it is stored and for how long.`
    },
    'terms-of-service': {
        kind: 'page', section: 'Legal', title: 'Terms of service', path: KnownPages.LegalTermsOfService,
        description: `The terms for using ${brand.domain} and leaving comments with the ${brand.name} toolbar.`
    },
    'cookie-policy': {
        kind: 'page', section: 'Legal', title: 'Cookie policy', path: KnownPages.LegalCookiePolicy,
        description: `The cookies and the browser storage ${brand.domain} uses, and why.`
    },
    'acceptable-use-policy': {
        kind: 'page', section: 'Legal', title: 'Acceptable use policy', path: KnownPages.LegalAcceptableUsePolicy,
        description: `What you may not do with ${brand.domain} and the ${brand.name} toolbar, and how to report abuse.`
    },
    sla: {
        kind: 'page', section: 'Legal', title: 'Service level agreement', path: KnownPages.LegalSla,
        description: `${brand.name} is free and has no service level agreement: no uptime, response time or support commitments.`
    }
} satisfies Record<string, PageCard>;

export const linkCards = {
    comment: {
        kind: 'link', picture: 'comment', section: 'Comment', title: 'Open the comment on the page',
        description: 'It stays pinned to the element it is about, on the live site.'
    },
    review: {
        kind: 'link', picture: 'review', section: 'Review link', title: 'Review the live site',
        description: 'Open the site with the toolbar and leave comments directly on the page.'
    },
    invitation: {
        kind: 'link', picture: 'invitation', section: 'Invitation', title: 'You are invited',
        description: 'Accept the invitation to sign in and review sites with your team.'
    },
    'sign-in': {
        kind: 'link', picture: 'app', section: 'App', title: `Continue in ${brand.name}`,
        description: 'Sign in to see your projects and the comments left on their pages.'
    }
} satisfies Record<string, LinkCard>;

export type PageCardId = keyof typeof pageCards;
export type LinkCardId = keyof typeof linkCards;
export type SocialCardId = PageCardId | LinkCardId;

const socialCards: Record<SocialCardId, SocialCard> = { ...pageCards, ...linkCards };

export const socialCardIds = Object.keys(socialCards) as SocialCardId[];

export function isSocialCardId(value: string): value is SocialCardId {
    return Object.hasOwn(socialCards, value);
}

export function socialCard(id: SocialCardId): SocialCard {
    return socialCards[id];
}

/** What the card shows, for people who cannot see it */
export function socialCardAlt(card: SocialCard) {
    return card.kind === 'page' ? `${card.title} · ${brand.name}` : `${card.section} · ${card.title}`;
}
