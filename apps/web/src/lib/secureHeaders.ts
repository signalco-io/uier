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
    vercelToolbar: {
        imgSrc: ['https://vercel.com', 'https://vercel.live', 'https://sockjs-mt1.pusher.com', 'data: blob:'],
        scriptSrc: ['https://vercel.live', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com'],
        connectSrc: ['https://vercel.live', 'https://vercel.com', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com', 'https://sockjs-mt1.pusher.com', 'wss://ws-mt1.pusher.com'],
        frameSrc: ['https://vercel.live', 'https://vercel.com']
    }
} satisfies Record<string, SecureHeadersExternalUrls>;

export const permissionsPolicy = 'camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=()';

/** Production analytics 2.0.1 loads /_vercel/insights/script.js and posts to this origin. */
export function siteExternalUrls(isDevelopment: boolean, isPreview: boolean): SecureHeadersExternalUrls[] {
    const blobOrigin = process.env.AZURE_SCREENSHOTS_ENDPOINT ? new URL(process.env.AZURE_SCREENSHOTS_ENDPOINT).origin : undefined;
    return [
        ...(blobOrigin ? [{ imgSrc: [blobOrigin], connectSrc: [blobOrigin] }] : []),
        ...(isPreview ? [knownSecureHeadersExternalUrls.vercelToolbar] : []),
        ...(isDevelopment ? [{
            scriptSrc: ['http://localhost:4005', 'https://va.vercel-scripts.com'],
            styleSrc: ['http://localhost:4005'], connectSrc: ['http://localhost:4005']
        }] : [])
    ];
}

export function combineSecureHeaders(
    baseDomains: string[],
    allowSubdomains: boolean,
    isDevelopment: boolean,
    externalUrls: SecureHeadersExternalUrls[],
    nonce?: string,
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
                scriptSrc: ['\'self\'', ...external('scriptSrc'), ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : ["'unsafe-inline'"]), ...(isDevelopment ? ['\'unsafe-eval\''] : [])],
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
                baseURI: "'self'",
                'frame-ancestors': frameAncestors.length ? frameAncestors : '\'none\''
            }
        },
        xssProtection: false,
        forceHTTPSRedirect: [true, { maxAge: 31536000, includeSubDomains: true }],
        referrerPolicy: 'same-origin'
    };
}
