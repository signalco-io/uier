import { brand } from '@uier/brand';
import { keyedHash } from '../comments/environment';
import { getCommentsStore } from '../repo/commentsStore';

export type ServiceState = 'operational' | 'down';

export type ServiceStatus = {
    id: 'website' | 'comments';
    name: string;
    description: string;
    state: ServiceState;
};

export type StatusReport = {
    /** `operational` when every service is */
    state: ServiceState;
    /** ISO time of the checks */
    checkedAt: string;
    services: ServiceStatus[];
};

/** Results are reused for this long, so a busy status page can't turn into load on the database */
export const STATUS_CACHE_SECONDS = 30;
const CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * What every comments request needs: the server key (`UIER_COMMENTS_SECRET`) and an answer from
 * the comments store. A point read of a document that doesn't exist (the cheapest Cosmos DB read).
 */
async function checkComments(): Promise<ServiceState> {
    try {
        keyedHash('status', 'check');
        await withTimeout(getCommentsStore().get(brand.domain, 'status-check'), CHECK_TIMEOUT_MS);
        return 'operational';
    } catch (error) {
        console.error('[status] Comments API check failed', error);
        return 'down';
    }
}

async function runChecks(): Promise<StatusReport> {
    const comments = await checkComments();
    const services: ServiceStatus[] = [
        {
            id: 'website',
            name: 'Website',
            description: `${brand.domain}, its pages and /toolbar.js. If you can read this, it is up.`,
            state: 'operational'
        },
        {
            id: 'comments',
            name: 'Comments',
            description: 'The comments API and its database, checked with a live read.',
            state: comments
        }
    ];

    return {
        state: services.every(service => service.state === 'operational') ? 'operational' : 'down',
        checkedAt: new Date().toISOString(),
        services
    };
}

let cached: { report: Promise<StatusReport>; expiresAt: number } | null = null;

/** The current state of uier's services, checked live (at most every {@link STATUS_CACHE_SECONDS} seconds) */
export function getServiceStatus(): Promise<StatusReport> {
    const now = Date.now();
    if (!cached || cached.expiresAt <= now)
        cached = { report: runChecks(), expiresAt: now + STATUS_CACHE_SECONDS * 1000 };
    return cached.report;
}
