import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dailyRewriteReport } from '../src/lib/rewrite/report';
import type { RewriteEvent } from '../src/lib/rewrite/telemetry';

export async function main(args: string[]) {
    const [path, day, environment] = args;
    if (!path || !day || !['production', 'preview', 'local', 'unknown'].includes(environment ?? '') || args.length !== 3)
        throw new Error('Usage: rewrite-tools.mjs report logs.ndjson YYYY-MM-DD production|preview|local|unknown');
    const records: unknown[] = [];
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        try {
            const parsed: unknown = JSON.parse(line);
            if (parsed === null || typeof parsed !== 'object') continue;
            const entry = parsed as Record<string, unknown>;
            // Accept raw events and Vercel JSON log exports. Unrelated messages are ignored.
            const event: unknown = typeof entry.message === 'string' ? JSON.parse(entry.message) : entry;
            if (event !== null && typeof event === 'object' && 'event' in event && event.event === 'rewrite_usage') records.push(event);
        } catch { /* Unrelated non-JSON log messages contain no accounting data. */ }
    }
    process.stdout.write(`${JSON.stringify(dailyRewriteReport(records, day, environment as RewriteEvent['environment']), null, 2)}\n`);
}
