import type { CosmosDiagnostics, QueryIterator } from '@azure/cosmos';

type Response = { requestCharge?: number; diagnostics?: CosmosDiagnostics; code?: number; resource?: unknown; resources?: unknown[]; headers?: Record<string, unknown> };
type Labels = { operation: string; container: string; partition: 'single' | 'cross' };
const containers = new Set(['app', 'app-preview', 'comments', 'comments-preview']);
let windowStart = 0, emitted = 0;

/** Opt-in sampling, capped per process. No documents, identities, SQL or diagnostic payloads. */
export function cosmosMeasurement(labels: Labels) {
    const configured = Number(process.env.UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE ?? 0);
    const rate = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : 0;
    const sampled = rate > 0 && Math.random() < rate;
    const start = performance.now();
    let requestCharge = 0, pages = 0, rows = 0, retries = 0, throttles = 0;
    return {
        add(value: unknown, count: number, page = false) {
            if (!sampled || !value || typeof value !== 'object') return;
            const response = value as Response;
            const charge = Number(response.requestCharge ?? response.headers?.['x-ms-request-charge'] ?? 0);
            if (Number.isFinite(charge)) requestCharge += charge;
            rows += count;
            if (page) pages++;
            const attempts = response.diagnostics?.clientSideRequestStatistics?.retryDiagnostics?.failedAttempts ?? [];
            retries += attempts.length;
            throttles += attempts.filter(attempt => attempt.statusCode === 429).length;
            if (response.code === 429) throttles++;
        },
        finish(failed = false) {
            if (!sampled) return;
            const now = Date.now();
            if (now - windowStart >= 60_000) { windowStart = now; emitted = 0; }
            if (emitted++ >= 120) {
                if (emitted === 121) console.info('[cosmos]', JSON.stringify({ event: 'sample-cap', windowMs: 60_000 }));
                return;
            }
            // Labels are code-defined. Still bound their length and never include partition values.
            console.info('[cosmos]', JSON.stringify({ operation: labels.operation.slice(0, 240),
                container: containers.has(labels.container) ? labels.container : 'other', partition: labels.partition,
                environment: process.env.UIER_DEPLOYMENT_ENV === 'production' ? 'production'
                    : process.env.VERCEL_ENV === 'preview' ? 'preview' : 'local',
                workload: process.env.UIER_COSMOS_WORKLOAD === 'scheduled' ? 'scheduled' : 'interactive',
                sampleRate: rate, requestCharge, durationMs: Math.round(performance.now() - start), rows, pages, retries, throttles, failed }));
        }
    };
}

/** Drain every SDK page, including empty pages with continuation; never truncate complete lists. */
export async function cosmosQueryAll<T>(iterator: QueryIterator<T>, labels: Labels): Promise<T[]> {
    const measurement = cosmosMeasurement(labels);
    const resources: T[] = [];
    try {
        while (iterator.hasMoreResults()) {
            const response = await iterator.fetchNext();
            // SDK may produce a final empty local response with no backend request.
            if (response.resources !== undefined || response.requestCharge) measurement.add(response, response.resources?.length ?? 0, true);
            resources.push(...(response.resources ?? []));
        }
        measurement.finish();
        return resources;
    } catch (error) {
        measurement.add(error as Response, 0);
        measurement.finish(true);
        throw error;
    }
}

export async function cosmosPoint<T>(operation: () => Promise<T>, labels: Labels): Promise<T> {
    const measurement = cosmosMeasurement(labels);
    try {
        const response = await operation();
        const shape = response && typeof response === 'object' ? response as Response : {};
        measurement.add(response, shape.resources?.length ?? (shape.resource ? 1 : 0), shape.resources !== undefined);
        measurement.finish();
        return response;
    } catch (error) {
        measurement.add(error as Response, 0);
        measurement.finish(true);
        throw error;
    }
}

/** Only fixed partition families, never the suffix (which can contain an address or token). */
export function appPointOperation(pk: string) {
    const family = pk.split(':', 1)[0] ?? 'other';
    return ['user', 'workspace', 'email', 'project', 'project-public', 'notifications', 'review-read', 'read', 'mcp-user',
        'invitation', 'sign-in', 'passkey', 'passkey-challenge', 'integration-status', 'integrations',
        'github', 'linear', 'notion', 'slack', 'azure-devops', 'thread-cleanup', 'project-deletion'].includes(family)
        ? family : 'other';
}
