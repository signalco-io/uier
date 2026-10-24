import type { NextConfig } from 'next';
import { createSecureHeaders } from 'next-secure-headers';
import { combineSecureHeaders, knownSecureHeadersExternalUrls } from './src/lib/secureHeaders';

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
    reactStrictMode: true,
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
        }];
    },
};

export default nextConfig;
