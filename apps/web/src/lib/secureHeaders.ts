import type { createSecureHeaders } from 'next-secure-headers';
import { createHash } from 'node:crypto';
import { themeScript } from './themeScript';

const themeScriptHash = `'sha256-${createHash('sha256').update(themeScript).digest('base64')}'`;
// React 19's fixed shell timing shim is emitted during prerendering, before any nonce exists.
// The CSP browser regression verifies the actual emitted bytes, including after dependency updates.
const shellTimingScriptHash = `'sha256-${createHash('sha256').update('requestAnimationFrame(function(){$RT=performance.now()});').digest('base64')}'`;

// Inlined from the signalco monorepo private package `@signalco/data/node`
// (combineSecureHeaders + the knownSecureHeadersExternalUrls entries uier uses).

type SecureHeadersOptions = NonNullable<Parameters<typeof createSecureHeaders>[0]>;

export type SecureHeadersExternalUrls = {
    scriptSrc?: string[];
    styleSrc?: string[];
    fontSrc?: string[];
    frameSrc?: string[];
    imgSrc?: string[];
    mediaSrc?: string[];
    connectSrc?: string[];
    frameAncestors?: string[];
};

/**
 * A project site's icon, served from uier.io (`/api/projects/<id>/icon`): another site's SVG must never
 * run as a uier.io page. `proxy.ts` sends it in place of the page policy; the route sends it too.
 */
export const siteIconContentSecurityPolicy = 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox';
/** The icon route's path (`proxy.ts`) */
export const siteIconPath = /^\/api\/projects\/[^/]+\/icon$/;

export const knownSecureHeadersExternalUrls = {
    vercelToolbar: {
        imgSrc: ['https://vercel.com', 'https://vercel.live', 'https://sockjs-mt1.pusher.com', 'data: blob:'],
        scriptSrc: ['https://vercel.live', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com'],
        connectSrc: ['https://vercel.live', 'https://vercel.com', 'https://vitals.vercel-insights.com', 'https://*.vercel-scripts.com', 'https://sockjs-mt1.pusher.com', 'wss://ws-mt1.pusher.com'],
        frameSrc: ['https://vercel.live', 'https://vercel.com']
    }
} satisfies Record<string, SecureHeadersExternalUrls>;

// Passkeys use publickey-credentials-create/-get with their default `self` allowlist (the top-level
// app pages); never list them here as `()`. e2e/passkeys.spec.ts runs both under these headers.
export const restrictedPermissionsPolicy = 'camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=()';
/** Recording starts only from an explicit browser permission prompt in the top-level review page. */
export const permissionsPolicy = 'camera=(), microphone=(), geolocation=(), display-capture=(self), payment=(), usb=()';

/** Production analytics 2.0.1 loads /_vercel/insights/script.js and posts to this origin. */
export function siteExternalUrls(isDevelopment: boolean, isPreview: boolean): SecureHeadersExternalUrls[] {
    const blobOrigin = process.env.AZURE_SCREENSHOTS_ENDPOINT ? new URL(process.env.AZURE_SCREENSHOTS_ENDPOINT).origin : undefined;
    // The toolbar's watch build in `next dev`, on the port after this app's (next.config.ts)
    const toolbarDevOrigin = process.env.UIER_TOOLBAR_DEV_ORIGIN ?? '';
    return [
        ...(blobOrigin ? [{ imgSrc: [blobOrigin], connectSrc: [blobOrigin], mediaSrc: [blobOrigin] }] : []),
        ...(isPreview ? [knownSecureHeadersExternalUrls.vercelToolbar] : []),
        ...(isDevelopment ? [{
            scriptSrc: [toolbarDevOrigin, 'https://va.vercel-scripts.com'],
            styleSrc: [toolbarDevOrigin], connectSrc: [toolbarDevOrigin]
        }] : [])
    ];
}

export function combineSecureHeaders(
    baseDomains: string[],
    allowSubdomains: boolean,
    isDevelopment: boolean,
    externalUrls: SecureHeadersExternalUrls[],
    nonce?: string,
    staticShell = false,
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
                scriptSrc: ['\'self\'', ...external('scriptSrc'), ...(nonce ? [`'nonce-${nonce}'`, ...(staticShell ? [themeScriptHash, shellTimingScriptHash] : ["'strict-dynamic'"])] : ["'unsafe-inline'"]), ...(isDevelopment ? ['\'unsafe-eval\''] : [])],
                ...(staticShell ? { 'script-src-attr': "'none'" } : {}),
                objectSrc: '\'none\'',
                styleSrc: ['\'self\'', ...external('styleSrc'), '\'unsafe-inline\''],
                fontSrc: ['\'self\'', ...external('fontSrc'), '\'self\' data:'],
                manifestSrc: '\'self\'',
                mediaSrc: ['\'self\'', 'blob:', ...external('mediaSrc')],
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
