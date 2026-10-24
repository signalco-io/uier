import { headers } from 'next/headers';
import { brand } from '@uier/brand';
import { isLocalRuntime } from '../comments/environment';
import { ipRateLimitBucket, isLoopbackIp } from '../comments/visitor';

/**
 * Base URL for links the app sends (emails) and redirects to: uier.io in production, the
 * deployment URL on previews, `UIER_BASE_URL` when set. Only local development derives it from the
 * request's Host header (anywhere else a forged Host could point sign-in links to another site).
 */
export async function appBaseUrl() {
    const configured = process.env.UIER_BASE_URL?.trim();
    if (configured)
        return configured.replace(/\/+$/, '');
    if (process.env.VERCEL_ENV === 'production')
        return brand.url;

    const vercelUrl = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (vercelUrl)
        return `https://${vercelUrl}`;

    if (!isLocalRuntime())
        throw new Error('UIER_BASE_URL is required outside Vercel and local development.');

    const requestHeaders = await headers();
    const host = requestHeaders.get('host') ?? 'localhost:4004';
    const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
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
