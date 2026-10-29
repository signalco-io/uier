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
            // Self-hosted Geist files used on arbitrary reviewed origins.
            source: '/toolbar-fonts/:asset*',
            headers: [
                { key: 'Access-Control-Allow-Origin', value: '*' },
                { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' }
            ]
        }, {
            // Unversioned toolbar bundle: short cache and cross-origin embedding.
            source: '/toolbar.js',
            headers: [
                { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
                { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
                { key: 'Access-Control-Allow-Origin', value: '*' },
            ]
        }];
    },
};

// BotID (comments API bot protection): proxies the BotID challenge scripts through this origin, so they are
// covered by `script-src 'self'` / `connect-src 'self'`. Vercel also routes them automatically.
export default withBotId(nextConfig);
