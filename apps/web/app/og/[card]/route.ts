import { isSocialCardId, socialCard, socialCardIds } from '@/src/lib/social/cards';
import { renderSocialCard } from '@/src/lib/social/SocialCard';

// The social cards of public pages and app links (`/og/<card>`), rendered once at build time.
// Unknown cards are a 404: nothing here draws text from the request.
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
    return socialCardIds.map(card => ({ card }));
}

export async function GET(_request: Request, { params }: RouteContext<'/og/[card]'>) {
    const { card } = await params;
    if (!isSocialCardId(card))
        return new Response('Not found', { status: 404 });
    return renderSocialCard(socialCard(card));
}
