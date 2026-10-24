import type { createSecureHeaders } from 'next-secure-headers';

// Inlined from the signalco monorepo private package `@signalco/data/node`
// (combineSecureHeaders + the knownSecureHeadersExternalUrls entries uier uses).

type SecureHeadersOptions = NonNullable<Parameters<typeof createSecureHeaders>[0]>;

export type SecureHeadersExternalUrls = {
    scriptSrc?: string[];
    styleSrc?: string[];
    fontSrc?: string[];
    frameSrc?: string[];
    imgSrc?: string[];
    connectSrc?: string[];
    frameAncestors?: string[];
};

export const knownSecureHeadersExternalUrls = {
    googleFonts: {
        fontSrc: ['https://fonts.gstatic.com'],
        connectSrc: ['https://fonts.gstatic.com']
    },
    vercel: {
        imgSrc: ['https://vercel.com', 'https://vercel.live', 'https://sockjs-mt1.pusher.com', 'data: blob:'],
        scriptSrc: ['https://vercel.live', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com'],
        connectSrc: ['https://vercel.live', 'https://vercel.com', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com', 'https://sockjs-mt1.pusher.com', 'wss://ws-mt1.pusher.com'],
        frameSrc: ['https://vercel.live', 'https://vercel.com']
    }
} satisfies Record<string, SecureHeadersExternalUrls>;

export function combineSecureHeaders(
    baseDomains: string[],
    allowSubdomains: boolean,
    isDevelopment: boolean,
    externalUrls: SecureHeadersExternalUrls[],
): SecureHeadersOptions {
    const baseSubdomains = allowSubdomains
        ? baseDomains.map(bd => `*.${bd.split('.').slice(-2).join('.')}`)
        : [];
    const external = (key: keyof SecureHeadersExternalUrls) => externalUrls.flatMap(e => e[key] ?? []);
    const frameAncestors = external('frameAncestors');

    return {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: '\'self\'',
                scriptSrc: ['\'self\'', ...external('scriptSrc'), '\'unsafe-inline\'', ...(isDevelopment ? ['\'unsafe-eval\''] : [])],
                objectSrc: '\'none\'',
                styleSrc: ['\'self\'', ...external('styleSrc'), '\'unsafe-inline\''],
                fontSrc: ['\'self\'', ...external('fontSrc'), '\'self\' data:'],
                manifestSrc: '\'self\'',
                mediaSrc: '\'self\'',
                childSrc: '\'self\'',
                frameSrc: ['\'self\'', ...baseSubdomains, ...external('frameSrc')],
                workerSrc: ['\'self\'', '\'self\' blob:'],
                imgSrc: ['\'self\'', 'data:', 'blob:', ...baseSubdomains, ...external('imgSrc')],
                formAction: '\'self\'',
                connectSrc: ['\'self\'', ...baseSubdomains, ...external('connectSrc')],
                baseURI: baseDomains,
                'frame-ancestors': frameAncestors.length ? frameAncestors : '\'none\''
            }
        },
        xssProtection: 'block-rendering',
        forceHTTPSRedirect: [true, { maxAge: 60 * 60 * 24 * 4, includeSubDomains: allowSubdomains }],
        referrerPolicy: 'same-origin'
    };
}
