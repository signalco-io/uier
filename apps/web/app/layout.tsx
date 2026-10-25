import { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { brand } from '@uier/brand';
import './global.css';
import { Analytics } from '@vercel/analytics/react';
import { ClientProvider } from '../src/components/providers/ClientProvider';
import { AuthProvider } from '../src/components/providers/AuthProvider';
import { DevReviewToolbarScript } from '../src/components/toolbar/DevReviewToolbarScript';

const isDevelopment = process.env.NODE_ENV === 'development';

export default function RootLayout({ children }: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
            <body className={'font-sans antialiased'}>
                <AuthProvider>
                    <ClientProvider>
                        {children}
                        <Analytics />
                        {/* Review toolbar from the local packages/toolbar dev server (`pnpm dev`); the public layout embeds it in showcase mode */}
                        {isDevelopment && <DevReviewToolbarScript />}
                    </ClientProvider>
                </AuthProvider>
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
    openGraph: {
        type: 'website',
        siteName: brand.name,
        title: `${brand.name} · ${brand.tagline}`,
        description: brand.shortDescription,
        url: brand.url
    },
    twitter: {
        card: 'summary_large_image',
        title: `${brand.name} · ${brand.tagline}`,
        description: brand.shortDescription
    }
} satisfies Metadata;

export const viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: brand.themeColor.light },
        { media: '(prefers-color-scheme: dark)', color: brand.themeColor.dark },
        { color: brand.themeColor.dark }
    ]
} satisfies Viewport;
