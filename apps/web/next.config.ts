import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';
import { createSecureHeaders } from 'next-secure-headers';
import { combineSecureHeaders, knownSecureHeadersExternalUrls } from './src/lib/secureHeaders';

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // The deployment environment (production or preview), inlined at build time: the deploy
    // workflow sets UIER_DEPLOYMENT_ENV for `vercel build` (the project exposes no Vercel system
    // variables). Read it with `deploymentEnvironment()` (src/lib/app/request.ts).
    env: {
        UIER_DEPLOYMENT_ENV: process.env.UIER_DEPLOYMENT_ENV || process.env.VERCEL_ENV || ''
    },
    reactCompiler: true,
    // @uier/brand ships TypeScript sources (tokens, Mark, Logo); Next compiles them like app code.
    transpilePackages: ['@uier/brand'],
    images: {
        dangerouslyAllowSVG: true,
        contentSecurityPolicy: 'default-src \'self\'; script-src \'none\'; sandbox;',
        remotePatterns: [
            {
                hostname: 'uier.io',
                pathname: '/images/**',
                protocol: 'https',
            },
            {
                hostname: 'uier.io',
                pathname: '/assets/**',
                protocol: 'https',
            }
        ]
    },
    async headers() {
        return [{
            source: '/((?!review-(?:verification|session)$).*)',
            headers: createSecureHeaders(combineSecureHeaders(
                ['uier.io'],
                false,
                isDevelopment,
                [
                    knownSecureHeadersExternalUrls.vercel,
                    knownSecureHeadersExternalUrls.googleFonts,
                    // Local review toolbar dev server (packages/toolbar `pnpm dev`)
                    ...(isDevelopment
                        ? [{ scriptSrc: ['http://localhost:4005'], styleSrc: ['http://localhost:4005'], connectSrc: ['http://localhost:4005'] }]
                        : []),
                ]
            ))
        }, {
            // Empty verification/session bridges return results only to the requesting parent;
            // the server checks that origin against the project's sites.
            source: '/review-:bridge(verification|session)',
            headers: createSecureHeaders({
                ...combineSecureHeaders(['uier.io'], false, isDevelopment, [
                    knownSecureHeadersExternalUrls.vercel,
                    { frameAncestors: ['*'] }
                ]),
                frameGuard: false
            }).concat([{ key: 'Cache-Control', value: 'no-store' }])
        }, {
            // Toolbar bundle (packages/toolbar, copied to public/ by scripts/copy-toolbar.mjs).
            // The default URL follows releases, so it is cached briefly. Customer sites
            // will embed it from uier.io, so any origin may load it.
            source: '/toolbar.js',
            headers: [
                { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
                { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
                { key: 'Access-Control-Allow-Origin', value: '*' },
            ]
        }, {
            source: '/toolbar/:hash([a-f0-9]{64}).js',
            headers: [
                { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
                { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
                { key: 'Access-Control-Allow-Origin', value: '*' },
            ]
        }, {
            source: '/toolbar/manifest.json',
            headers: [{ key: 'Cache-Control', value: 'no-store' }]
        }];
    },
};

// BotID (comments API bot protection): proxies the BotID challenge scripts through this origin, so they are
// covered by `script-src 'self'` / `connect-src 'self'`. Vercel also routes them automatically.
export default withBotId(nextConfig);
