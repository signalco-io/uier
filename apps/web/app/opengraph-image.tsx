import { ImageResponse } from 'next/og';
import { brand, MARK_PATH, MARK_VIEWBOX } from '@uier/brand';
import { socialCardSize } from '@/src/lib/social/cards';
import { CardMotif, socialCardFonts } from '@/src/lib/social/SocialCard';

// The brand card (BRAND.md, "Marketing and metadata"), rendered at build time from the brand
// constants. Served at /opengraph-image for the landing page and every page without a card of its
// own; the other cards are in src/lib/social.

export const alt = `${brand.name} · ${brand.tagline}`;
export const size = socialCardSize;
export const contentType = 'image/png';

export default async function OpenGraphImage() {
    const { ink, paper, ink500, ink700 } = brand.colors;

    return new ImageResponse(
        (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: paper, color: ink, fontFamily: 'Geist' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <svg viewBox={MARK_VIEWBOX} width={56} height={56}><path d={MARK_PATH} fill={ink} /></svg>
                    <div style={{ display: 'flex', fontSize: 76, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 0.9, marginTop: -6 }}>{brand.name}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
                    <div style={{ display: 'flex', fontSize: 64, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>{brand.tagline}</div>
                    <div style={{ display: 'flex', fontSize: 24, lineHeight: 1.4, color: ink500 }}>{brand.shortDescription}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 18, color: ink700 }}>{brand.domain}</div>
                    <CardMotif />
                </div>
            </div>
        ),
        { ...size, fonts: await socialCardFonts() }
    );
}
