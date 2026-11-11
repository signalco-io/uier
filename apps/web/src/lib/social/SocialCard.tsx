import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CSSProperties, ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { cacheLife } from 'next/cache';
import { brand, MARK_PATH, MARK_VIEWBOX, PIN_PATH, PIN_VIEWBOX } from '@uier/brand';
import { integrationLogos } from '@/src/components/app/integrations/IntegrationLogo';
import { socialCardSize, type LinkCard, type PageCard } from './cards';

// The social cards, drawn with satori (`next/og`) from the brand constants: paper, the lockup, the
// title, the address in mono, and a piece of the review layer as the picture (BRAND.md, "Marketing
// and metadata"). The pictures are specimens with placeholder bars, never words that could be
// mistaken for someone's comment or project.

const { ink, paper, black, ink50, ink100, ink200, ink300, ink500, ink700, darkBorder, darkElevated, accent } = brand.colors;
const floating = '0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.08)';
/** A commented text range: the accent at 20 % */
const selection = 'rgba(46,91,255,0.2)';

// Read by path from the app's node_modules (the build runs with apps/web as the working
// directory, locally through turbo and on Vercel through the project's root directory):
// the bundler rewrites `require.resolve`, and satori needs TTF, which next/font does not expose.
async function geistFont(file: string) {
    return readFile(join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', file));
}

/** Geist and Geist Mono for `ImageResponse` */
export async function socialCardFonts() {
    'use cache';
    cacheLife('max');
    const [sansSemiBold, sansRegular, monoRegular] = await Promise.all([
        geistFont('geist-sans/Geist-SemiBold.ttf'),
        geistFont('geist-sans/Geist-Regular.ttf'),
        geistFont('geist-mono/GeistMono-Regular.ttf')
    ]);
    return [
        { name: 'Geist', data: Uint8Array.from(sansSemiBold).buffer, weight: 600 as const, style: 'normal' as const },
        { name: 'Geist', data: Uint8Array.from(sansRegular).buffer, weight: 400 as const, style: 'normal' as const },
        { name: 'Geist Mono', data: Uint8Array.from(monoRegular).buffer, weight: 400 as const, style: 'normal' as const }
    ];
}

/** The product pin: the mark on a 32 grid, ink fill, 2 px white ring, the count inside */
export function CardPin({ count, size, style }: { count?: number; size: number; style?: CSSProperties }) {
    return (
        <div style={{ display: 'flex', position: 'relative', width: size, height: size, ...style }}>
            <svg viewBox={PIN_VIEWBOX} width={size} height={size}><path d={PIN_PATH} fill={ink} stroke={paper} strokeWidth={2} /></svg>
            {count !== undefined && <div style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', color: paper, fontSize: Math.round(size * 0.36), fontWeight: 600 }}>{count}</div>}
        </div>
    );
}

/** The toolbar pill: add a comment, then the inbox */
export function CardToolbar() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, background: black, border: `1px solid ${darkBorder}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 999, background: darkBorder }}>
                <svg viewBox={PIN_VIEWBOX} width={24} height={24} fill="none"><path d={PIN_PATH} stroke={paper} strokeWidth={1.75} /><path d="M9 16h14M16 9v14" stroke={paper} strokeWidth={2} strokeLinecap="round" /></svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 999 }}>
                <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke={paper} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
            </div>
        </div>
    );
}

/** The bottom-right motif of the brand card: a pin and the toolbar */
export function CardMotif() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <CardPin count={1} size={44} />
            <CardToolbar />
        </div>
    );
}

/** The horizontal lockup: mark at 0.8 × the wordmark size, gap 0.4 × (BRAND.md, "Lockups") */
function Lockup({ fontSize }: { fontSize: number }) {
    const mark = Math.round(fontSize * 0.8);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.4) }}>
            <svg viewBox={MARK_VIEWBOX} width={mark} height={mark}><path d={MARK_PATH} fill={ink} /></svg>
            <div style={{ display: 'flex', fontSize, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, marginTop: -Math.round(fontSize * 0.08) }}>{brand.name}</div>
        </div>
    );
}

function Address({ children }: { children: ReactNode }) {
    return <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 20, color: ink700 }}>{children}</div>;
}

/** A placeholder line of text or a heading */
function Bar({ width, height = 12, color = ink200, style }: { width: number | string; height?: number; color?: string; style?: CSSProperties }) {
    return <div style={{ display: 'flex', width, height, borderRadius: 4, background: color, flexShrink: 0, ...style }} />;
}

function Card({ children }: { children: ReactNode }) {
    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', padding: '72px 80px', background: paper, color: ink, fontFamily: 'Geist' }}>
            {children}
        </div>
    );
}

function PageCardImage({ card }: { card: PageCard }) {
    const logo = card.provider && integrationLogos[card.provider];
    return (
        <Card>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Lockup fontSize={50} />
                    {logo
                        ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, padding: 14, borderRadius: brand.radius.card, border: `1px solid ${ink200}`, background: paper }}>
                                <svg viewBox={logo.viewBox} width={44} height={44}>{logo.paths.map(path => <path key={path.d} d={path.d} fill={path.fill ?? ink} />)}</svg>
                            </div>
                        )
                        : card.section && <div style={{ display: 'flex', fontSize: 24, color: ink500 }}>{card.section}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 940 }}>
                    <div style={{ display: 'flex', fontSize: 72, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.04 }}>{card.title}</div>
                    <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.4, color: ink500 }}>{card.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Address>{`${brand.domain}${card.path}`}</Address>
                    <CardMotif />
                </div>
            </div>
        </Card>
    );
}

/** A page of an imaginary site: a frame of placeholder bars that a picture adds the review layer to */
function SiteFrame({ background = ink50, children }: { background?: string; children: ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: 430, height: '100%', padding: 32, borderRadius: brand.radius.frame, border: `1px solid ${ink200}`, background, position: 'relative', overflow: 'hidden' }}>
            {children}
        </div>
    );
}

function SiteNavigation() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', width: 22, height: 22, borderRadius: 6, background: ink300 }} />
            <Bar width={72} />
            <div style={{ display: 'flex', flexGrow: 1 }} />
            <Bar width={44} color={ink100} />
            <Bar width={44} color={ink100} />
        </div>
    );
}

function Avatar() {
    return <div style={{ display: 'flex', width: 28, height: 28, borderRadius: 999, background: ink100, border: `1px solid ${ink200}`, flexShrink: 0 }} />;
}

/** A comment on an element (the dashed outline), with its open thread */
function CommentPicture() {
    return (
        <div style={{ display: 'flex', position: 'relative', height: '100%' }}>
            <SiteFrame>
                <SiteNavigation />
                <Bar width="72%" height={26} color={ink300} />
                <Bar width="88%" />
                <Bar width="64%" />
                <div style={{ display: 'flex', position: 'relative', flexDirection: 'column', gap: 12, marginTop: 14, padding: 10, borderRadius: brand.radius.smallControl, border: `2px dashed ${accent}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><Bar width={140} /><Bar width={60} color={ink300} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><Bar width={110} /><Bar width={60} color={ink300} /></div>
                    <CardPin count={2} size={36} style={{ position: 'absolute', left: '62%', top: '52%' }} />
                </div>
                <Bar width="80%" style={{ marginTop: 14 }} />
                <Bar width="56%" />
            </SiteFrame>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'absolute', left: -64, bottom: 28, width: 300, padding: 18, borderRadius: brand.radius.card, border: `1px solid ${ink200}`, background: paper, boxShadow: floating }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar />
                    <Bar width={64} color={ink300} />
                    <Bar width={28} color={ink100} />
                </div>
                <Bar width="100%" />
                <Bar width="70%" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', height: 28, padding: '0 12px', borderRadius: 999, border: `1px solid ${ink200}`, fontSize: 15 }}>
                    <div style={{ display: 'flex', width: 7, height: 7, borderRadius: 999, background: ink }} />
                    Open
                </div>
            </div>
        </div>
    );
}

/** A site under review: comments on an element and on selected words, the toolbar at the bottom */
function ReviewPicture() {
    return (
        <SiteFrame>
            <SiteNavigation />
            <div style={{ display: 'flex', position: 'relative', alignSelf: 'flex-start' }}>
                <Bar width={250} height={26} color={ink300} />
                <CardPin count={1} size={40} style={{ position: 'absolute', left: 232, top: 12 }} />
            </div>
            <Bar width="88%" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bar width={90} />
                <div style={{ display: 'flex', position: 'relative', padding: '4px 2px', borderRadius: 3, background: selection }}>
                    <Bar width={110} color={ink300} />
                    <CardPin count={3} size={36} style={{ position: 'absolute', left: 102, top: 12 }} />
                </div>
            </div>
            <div style={{ display: 'flex', height: 120, marginTop: 18, borderRadius: brand.radius.card, border: `1px solid ${ink200}`, background: paper }} />
            <Bar width="70%" style={{ marginTop: 6 }} />
            <div style={{ display: 'flex', position: 'absolute', left: 0, right: 0, bottom: 28, justifyContent: 'center' }}>
                <CardToolbar />
            </div>
        </SiteFrame>
    );
}

/** The invitation email: the app icon, a heading and the one solid button */
function InvitationPicture() {
    return (
        <SiteFrame background={ink100}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: 'auto 0', padding: 28, borderRadius: brand.radius.panel, border: `1px solid ${ink200}`, background: paper }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 10, background: black }}>
                    <svg viewBox={MARK_VIEWBOX} width={24} height={24} style={{ marginTop: 1, marginLeft: 1 }}><path d={MARK_PATH} fill={paper} /></svg>
                </div>
                <Bar width="62%" height={22} color={ink300} style={{ marginTop: 6 }} />
                <Bar width="100%" />
                <Bar width="78%" />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 10, borderRadius: brand.radius.largeControl, background: ink, color: paper, fontSize: 19, fontWeight: 600 }}>
                    Accept invitation
                </div>
            </div>
        </SiteFrame>
    );
}

/** The inbox: always ink, the unread count in a blue pill (BRAND.md, "The review layer") */
function AppPicture() {
    const threads = [{ count: 2, unread: true }, { count: 1, unread: true }, { count: 3 }, { count: 1 }, { count: 4 }, { count: 2 }];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 430, height: '100%', padding: 14, borderRadius: brand.radius.panel, border: `1px solid ${darkBorder}`, background: black }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 14px' }}>
                <Bar width={110} height={14} color={ink700} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24, minWidth: 24, padding: '0 8px', borderRadius: 999, background: accent, color: paper, fontSize: 14, fontWeight: 600 }}>2</div>
            </div>
            {threads.map((thread, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 10px', borderRadius: brand.radius.card, background: index === 0 ? darkElevated : black }}>
                    <CardPin count={thread.count} size={32} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexGrow: 1 }}>
                        <Bar width={index % 2 ? '70%' : '90%'} color={ink700} />
                        <Bar width={84} height={10} color={darkBorder} />
                    </div>
                    <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 999, background: thread.unread ? accent : 'transparent' }} />
                </div>
            ))}
        </div>
    );
}

const pictures: Record<LinkCard['picture'], () => ReactNode> = {
    comment: CommentPicture,
    review: ReviewPicture,
    invitation: InvitationPicture,
    app: AppPicture
};

function LinkCardImage({ card }: { card: LinkCard }) {
    const Picture = pictures[card.picture];
    return (
        <Card>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 520, marginRight: 'auto' }}>
                <Lockup fontSize={50} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'flex', fontSize: 24, color: ink500 }}>{card.section}</div>
                    <div style={{ display: 'flex', fontSize: 58, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.04 }}>{card.title}</div>
                    <div style={{ display: 'flex', fontSize: 26, lineHeight: 1.4, color: ink500 }}>{card.description}</div>
                </div>
                <Address>{brand.domain}</Address>
            </div>
            <Picture />
        </Card>
    );
}

/**
 * A public page's card as a 1200 × 630 PNG: the default export of the `opengraph-image.tsx` next
 * to the page, with the same title and description as the page's metadata.
 */
export async function pageCardImage(card: PageCard) {
    return new ImageResponse(<PageCardImage card={card} />, { ...socialCardSize, fonts: await socialCardFonts() });
}

/** A link card (`linkCards`) as a 1200 × 630 PNG */
export async function linkCardImage(card: LinkCard) {
    return new ImageResponse(<LinkCardImage card={card} />, { ...socialCardSize, fonts: await socialCardFonts() });
}
