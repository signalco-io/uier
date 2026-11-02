import { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { brand } from '@uier/brand';
import { siteOpenGraph } from '@/src/lib/social/metadata';
import './global.css';
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
            <body className={'font-sans antialiased'}>
                {children}
            </body>
        </html>
    );
}

export const metadata = {
    metadataBase: new URL(brand.url),
    title: {
        default: `${brand.name} · ${brand.tagline}`,
        template: `%s · ${brand.name}`
    },
    description: brand.shortDescription,
    applicationName: brand.name,
    manifest: '/manifest.webmanifest',
    icons: {
        icon: [
            { url: '/favicon.svg', type: 'image/svg+xml' },
            { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
            { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' }
        ],
        apple: '/apple-touch-icon.png'
    },
    // Previews take each page's own title and description (and card, src/lib/social)
    openGraph: siteOpenGraph,
    twitter: { card: 'summary_large_image' }
} satisfies Metadata;

export const viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: brand.themeColor.light },
        { media: '(prefers-color-scheme: dark)', color: brand.themeColor.dark },
        { color: brand.themeColor.dark }
    ]
} satisfies Viewport;
