/** Pure deployment context, usable by both Next.js requests and scheduled workers. */
export function deploymentEnvironment(): 'production' | 'preview' | undefined {
    const value = process.env.UIER_DEPLOYMENT_ENV || process.env.VERCEL_ENV;
    return value === 'production' || value === 'preview' ? value : undefined;
}

/** The environment named in operational log events. */
export function logEnvironment(): 'production' | 'preview' | 'local' | 'unknown' {
    return deploymentEnvironment() ?? (process.env.UIER_LOCAL === '1' || process.env.NODE_ENV === 'development' ? 'local' : 'unknown');
}
import { brand } from '@uier/brand';


/** Same trusted URL for request emails and workers; no request headers are read here. */
export function configuredAppBaseUrl() {
    const configured = process.env.UIER_BASE_URL?.trim();
    return configured ? configured.replace(/\/+$/, '') : deploymentEnvironment() === 'production' ? brand.url : undefined;
}
