import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dailyMcpReport, isUtcDay, mcpLogRecord } from '../src/lib/mcp/report';
import type { McpRequestEvent } from '../src/lib/mcp/telemetrySchema';

const environments = ['production', 'preview', 'local', 'unknown'];

export async function main(args: string[]) {
    const [path, day, environment] = args;
    if (args.length !== 3 || !path || !day || !isUtcDay(day) || !environments.includes(environment ?? ''))
        throw new Error('Usage: mcp-report.mjs logs.ndjson YYYY-MM-DD production|preview|local|unknown');
    const records: unknown[] = [];
    // Raw events and Vercel JSON log exports; unrelated and non-JSON lines are skipped without being read further.
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
        const record = mcpLogRecord(line);
        if (record !== undefined) records.push(record);
    }
    process.stdout.write(`${JSON.stringify(dailyMcpReport(records, day, environment as McpRequestEvent['environment']), null, 2)}\n`);
}
