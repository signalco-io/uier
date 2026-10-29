import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';
import { createSecureHeaders } from 'next-secure-headers';
import { botIdHeaders } from './src/lib/botIdProxy';
import { combineSecureHeaders } from './src/lib/secureHeaders';

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
            // Response-independent defaults also cover static files and BotID rewrites. Page CSP,
            // framing and browser capabilities are set in proxy.ts using exact pathname checks.
            source: '/:path*',
            headers: createSecureHeaders({
                ...combineSecureHeaders(['uier.io'], false, false, []),
                contentSecurityPolicy: false,
                frameGuard: false
            })
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
// Inspected the live challenge (JavaScript) and iframe endpoint (empty HTML). These are
// same-origin scripts, workers and fetches, not app pages. Keep same-origin framing without
// allowing arbitrary inline scripts or inheriting the public page's inline-script exception.
export default withBotId(nextConfig, botIdHeaders);
