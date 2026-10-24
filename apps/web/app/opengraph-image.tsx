import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { brand, MARK_PATH, MARK_VIEWBOX, PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// The social card (BRAND.md, "Marketing and metadata"), rendered at build time from the brand
// constants with the Geist TTFs that the `geist` package ships. Served at /opengraph-image.

export const alt = `${brand.name} · ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

// Read by path from the app's node_modules (the build runs with apps/web as the working
// directory, locally through turbo and on Vercel through the project's root directory):
// the bundler rewrites `require.resolve`, and satori needs TTF, which next/font does not expose.
async function geistFont(file: string) {
    return readFile(join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', file));
}

export default async function OpenGraphImage() {
    const [sansSemiBold, sansRegular, monoRegular] = await Promise.all([
        geistFont('geist-sans/Geist-SemiBold.ttf'),
        geistFont('geist-sans/Geist-Regular.ttf'),
        geistFont('geist-mono/GeistMono-Regular.ttf')
    ]);
    const { ink, paper, ink500, ink700, black, darkBorder } = brand.colors;

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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                        <div style={{ display: 'flex', position: 'relative', width: 44, height: 44 }}>
                            <svg viewBox={PIN_VIEWBOX} width={44} height={44}><path d={PIN_PATH} fill={ink} stroke={paper} strokeWidth={2} /></svg>
                            <div style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: paper, fontSize: 16, fontWeight: 600 }}>1</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, background: black, border: `1px solid ${darkBorder}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 999, background: darkBorder }}>
                                <svg viewBox={PIN_VIEWBOX} width={24} height={24} fill="none"><path d={PIN_PATH} stroke={paper} strokeWidth={1.75} /><path d="M9 16h14M16 9v14" stroke={paper} strokeWidth={2} strokeLinecap="round" /></svg>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 999 }}>
                                <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={paper} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
                            </div>
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
