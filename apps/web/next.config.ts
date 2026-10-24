import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';
import { createSecureHeaders } from 'next-secure-headers';
import { combineSecureHeaders, knownSecureHeadersExternalUrls } from './src/lib/secureHeaders';

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // The Vercel environment (production or preview), inlined at build time: `vercel build` sets
    // VERCEL_ENV, but the project does not expose system variables to its functions at runtime.
    // Read it with `deploymentEnvironment()` (src/lib/app/request.ts).
    env: {
        UIER_DEPLOYMENT_ENV: process.env.VERCEL_ENV ?? ''
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
            source: '/(.*)',
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
            // Toolbar bundle (packages/toolbar, copied to public/ by scripts/copy-toolbar.mjs).
            // The URL is not versioned, so it is cached briefly (not immutable). Customer sites
            // will embed it from uier.io, so any origin may load it.
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
