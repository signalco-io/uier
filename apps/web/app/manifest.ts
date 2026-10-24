import type { MetadataRoute } from 'next';
import { brand } from '@uier/brand';

// Served at /manifest.webmanifest (referenced from app/layout.tsx metadata).
// Icons are rendered from the mark by `pnpm -C packages/brand icons`.
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: brand.name,
        short_name: brand.name,
        description: brand.shortDescription,
        categories: ['business', 'productivity', 'utilities'],
        icons: [
            { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        theme_color: brand.themeColor.dark,
        background_color: brand.themeColor.dark,
        start_url: '/app',
        id: '/app',
        scope: '/app',
        display: 'standalone'
    };
}
