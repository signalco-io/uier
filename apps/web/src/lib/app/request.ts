import { headers } from 'next/headers';
import { brand } from '@uier/brand';
import { isLocalRuntime } from '../comments/environment';
import { ipRateLimitBucket, isLoopbackIp } from '../comments/visitor';

/** The environment of this deployment (inlined at build time by the deploy workflow, see next.config.ts), if any */
export function deploymentEnvironment(): 'production' | 'preview' | undefined {
    const value = process.env.UIER_DEPLOYMENT_ENV || process.env.VERCEL_ENV;
    return value === 'production' || value === 'preview' ? value : undefined;
}

/**
 * Base URL for links the app sends (emails) and redirects to: `UIER_BASE_URL` when set, uier.io in
 * production, otherwise the request's host (previews and local development). On Vercel the Host
 * header decides which deployment serves a request, so it always names this deployment; anywhere
 * else (a build without UIER_DEPLOYMENT_ENV, self-hosting behind a proxy) a forged Host could point
 * sign-in links to another site, so `UIER_BASE_URL` is required there.
 */
export async function appBaseUrl() {
    const configured = process.env.UIER_BASE_URL?.trim();
    if (configured)
        return configured.replace(/\/+$/, '');
    if (deploymentEnvironment() === 'production')
        return brand.url;
    if (deploymentEnvironment() !== 'preview' && !isLocalRuntime())
        throw new Error('UIER_BASE_URL is required outside Vercel deployments and local development.');

    const requestHeaders = await headers();
    const host = requestHeaders.get('host');
    if (!host)
        throw new Error('The request has no Host header.');
    const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() || (isLocalRuntime() ? 'http' : 'https');
    return `${protocol}://${host}`;
}

/** The client's IP rate-limit bucket (IPv4 address or IPv6 /64); none for local loopback requests */
export async function requestIpBucket() {
    const requestHeaders = await headers();
    const ip = (requestHeaders.get('x-vercel-forwarded-for') ?? requestHeaders.get('x-forwarded-for'))?.split(',')[0]?.trim()
        || requestHeaders.get('x-real-ip')?.trim();
    if (!ip)
        return isLocalRuntime() ? undefined : 'unknown';
    if (isLocalRuntime() && isLoopbackIp(ip))
        return undefined;
    return ipRateLimitBucket(ip);
}
