import { isLinkCardId, linkCardIds, linkCards } from '@/src/lib/social/cards';
import { linkCardImage } from '@/src/lib/social/SocialCard';

// The cards of links into the app (`/og/<card>`), rendered once at build time. Unknown cards are
// a 404: nothing here draws text from the request. Public pages have their own opengraph-image.tsx.

export function generateStaticParams() {
    return linkCardIds.map(card => ({ card }));
}

export async function GET(_request: Request, { params }: RouteContext<'/og/[card]'>) {
    const { card } = await params;
    if (!isLinkCardId(card))
        return new Response('Not found', { status: 404 });
    return linkCardImage(linkCards[card]);
}
