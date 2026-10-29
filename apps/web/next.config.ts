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
    async rewrites() {
        // OAuth discovery for the MCP endpoint (src/lib/mcp/oauth). Only the path-specific protected
        // resource document exists: a root document would describe another resource (RFC 9728).
        return [
            { source: '/.well-known/oauth-protected-resource/api/mcp', destination: '/api/oauth/metadata/protected-resource' },
            { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata/authorization-server' }
        ];
    },
};

// BotID (comments API bot protection): proxies the BotID challenge scripts through this origin, so they are
// covered by `script-src 'self'` / `connect-src 'self'`. Vercel also routes them automatically.
// Inspected the live challenge (JavaScript) and iframe endpoint (empty HTML). These are
// same-origin scripts, workers and fetches, not app pages. Keep same-origin framing without
// allowing arbitrary inline scripts or inheriting the public page's inline-script exception.
export default withBotId(nextConfig, botIdHeaders);
