import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { brand, MARK_PATH, MARK_VIEWBOX, PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// The social card of /features/fix-verification: the brand card's layout (app/opengraph-image.tsx)
// with the page's title, and a thread waiting for its reviewer as the picture. The thread's labels
// are the product's own; the rest is placeholder bars, never words that read as someone's comment.

export const alt = `Fix verification · ${brand.name}: ask the reviewer to confirm the fix`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

// Read by path from the app's node_modules, like the brand card: satori needs TTF, which next/font does not expose
async function geistFont(file: string) {
    return readFile(join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', file));
}

export default async function OpenGraphImage() {
    const [sansSemiBold, sansRegular, monoRegular] = await Promise.all([
        geistFont('geist-sans/Geist-SemiBold.ttf'),
        geistFont('geist-sans/Geist-Regular.ttf'),
        geistFont('geist-mono/GeistMono-Regular.ttf')
    ]);
    const { ink, paper, ink500, ink700, ink200, ink100, ink50, accent } = brand.colors;
    const bar = (width: number) => <div style={{ display: 'flex', width, height: 12, borderRadius: 6, background: ink200 }} />;

    return new ImageResponse(
        (
            <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'space-between', gap: 56, padding: '72px 80px', background: paper, color: ink, fontFamily: 'Geist' }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <svg viewBox={MARK_VIEWBOX} width={44} height={44}><path d={MARK_PATH} fill={ink} /></svg>
                        <div style={{ display: 'flex', fontSize: 58, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 0.9, marginTop: -4 }}>{brand.name}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div style={{ display: 'flex', fontSize: 22, color: ink500 }}>Fix verification</div>
                        <div style={{ display: 'flex', fontSize: 58, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.02 }}>Ask the reviewer to confirm the fix</div>
                    </div>
                    <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 18, color: ink700 }}>{brand.domain}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ display: 'flex', position: 'relative', flexDirection: 'column', width: 400, borderRadius: 16, border: `1px solid ${ink200}`, background: paper, boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.08)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '22px 24px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 16px', borderRadius: 999, border: `1px solid ${ink200}`, fontSize: 18, fontWeight: 600 }}>
                                <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 999, background: accent }} />
                                Ready for review
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '22px 24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ display: 'flex', width: 32, height: 32, borderRadius: 999, background: ink100 }} />
                                {bar(90)}
                            </div>
                            {bar(310)}
                            {bar(220)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px 24px 24px', borderTop: `1px solid ${ink200}`, background: ink50, borderRadius: '0 0 16px 16px' }}>
                            {bar(250)}
                            <div style={{ display: 'flex', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 18px', borderRadius: 8, background: ink, color: paper, fontSize: 18, fontWeight: 600 }}>Confirm fix</div>
                                <div style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 18px', borderRadius: 8, border: `1px solid ${ink200}`, background: paper, fontSize: 18, fontWeight: 600 }}>Still needs work</div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', position: 'absolute', top: -22, left: -22, width: 44, height: 44 }}>
                            <svg viewBox={PIN_VIEWBOX} width={44} height={44}><path d={PIN_PATH} fill={ink} stroke={paper} strokeWidth={2} /></svg>
                            <div style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: paper, fontSize: 16, fontWeight: 600 }}>1</div>
                        </div>
                    </div>
                </div>
            </div>
        ),
        {
            ...size,
            fonts: [
                { name: 'Geist', data: sansSemiBold, weight: 600, style: 'normal' },
                { name: 'Geist', data: sansRegular, weight: 400, style: 'normal' },
                { name: 'Geist Mono', data: monoRegular, weight: 400, style: 'normal' }
            ]
        }
    );
}
