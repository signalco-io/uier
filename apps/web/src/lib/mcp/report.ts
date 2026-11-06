import { mcpRequestEventSchema, type McpRequestEvent } from './telemetrySchema';

/*
 * A UTC daily summary of exported `mcp_request` events, for deciding how to improve the tools,
 * prompts and resources. It reads only fields the event schema validates and outputs counts, codes,
 * registered names and sizes. Connection and account references are counted, never listed.
 */

type Tally = Map<string, number>;
type Entry = { method: McpRequestEvent['calls'][number]['method']; name: string | null; count: number; outcomes: Tally; errors: Tally;
    issues: Tally; missingScope: Tally; results: number; bytes: number[]; more: number; remaining: number; truncated: number;
    itemErrorCalls: number; itemErrors: Tally };

/** Longest lists in the report; the counts behind them are complete. */
const TOP = 20;
const TOP_ISSUES = 10;

const add = (tally: Tally, key: string, by = 1) => tally.set(key, (tally.get(key) ?? 0) + by);
/** Most frequent first; ties in key order, the same on every machine */
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (tally: Tally) => [...tally].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
const counts = (tally: Tally) => Object.fromEntries(sorted(tally));
/** Tallies of several fields use a JSON array as their key. */
const key = (...parts: (string | null | undefined)[]) => JSON.stringify(parts.map(part => part ?? null));
const top = <T>(tally: Tally, limit: number, fields: (parts: (string | null)[]) => T) =>
    sorted(tally).slice(0, limit).map(([entry, count]) => ({ ...fields(JSON.parse(entry) as (string | null)[]), count }));

function stats(values: number[]) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const percentile = (p: number) => ordered[Math.ceil(ordered.length * p) - 1]!;
    return { median: percentile(0.5), p95: percentile(0.95), max: ordered.at(-1)! };
}

export const isUtcDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));

/** One exported log line: a raw event, or a Vercel log object whose `message` is one. Anything else is ignored. */
export function mcpLogRecord(line: string): unknown {
    if (!line.trim()) return undefined;
    try {
        const parsed: unknown = JSON.parse(line);
        if (parsed === null || typeof parsed !== 'object') return undefined;
        const entry = parsed as Record<string, unknown>;
        const event: unknown = typeof entry.message === 'string' ? JSON.parse(entry.message) : entry;
        return event !== null && typeof event === 'object' && (event as Record<string, unknown>).event === 'mcp_request' ? event : undefined;
    } catch { return undefined; }
}

/** Aggregates the events of one UTC day and environment. Records that do not match the schema are counted and skipped; duplicate ids count once. */
export function dailyMcpReport(records: unknown[], day: string, environment: McpRequestEvent['environment']) {
    if (!isUtcDay(day)) throw new Error('Invalid UTC day');
    const seen = new Set<string>();
    const selected: McpRequestEvent[] = [];
    let rejectedRecords = 0, duplicateRecords = 0;
    for (const input of records) {
        const parsed = mcpRequestEventSchema.safeParse(input);
        if (!parsed.success) { rejectedRecords++; continue; }
        const event = parsed.data;
        if (!event.timestamp.startsWith(day) || event.environment !== environment) continue;
        if (seen.has(event.id)) { duplicateRecords++; continue; }
        seen.add(event.id); selected.push(event);
    }

    const outcomes: Tally = new Map(), errors: Tally = new Map(), authentication: Tally = new Map();
    const clients: Tally = new Map(), requestedNames: Tally = new Map(), unknownArguments: Tally = new Map(), serverErrors: Tally = new Map();
    const refs = new Set<string>(), users = new Set<string>(), refsByKind = { oauth: new Set<string>(), credential: new Set<string>() };
    const entries = new Map<string, Entry>();
    let omittedCalls = 0;
    for (const event of selected) {
        add(outcomes, event.outcome);
        if (event.error) add(errors, event.error);
        if (event.authentication) add(authentication, event.authentication);
        omittedCalls += event.omittedCalls ?? 0;
        if (event.connection) {
            refs.add(event.connection.ref); users.add(event.connection.user); refsByKind[event.connection.kind].add(event.connection.ref);
        }
        if (event.client) add(clients, key(event.client.name, event.client.version));
        if (event.failure) add(serverErrors, key(null, null, event.failure.name));
        for (const call of event.calls) {
            const id = key(call.method, call.name);
            let entry = entries.get(id);
            if (!entry) {
                entry = { method: call.method, name: call.name ?? null, count: 0, outcomes: new Map(), errors: new Map(), issues: new Map(),
                    missingScope: new Map(), results: 0, bytes: [], more: 0, remaining: 0, truncated: 0, itemErrorCalls: 0, itemErrors: new Map() };
                entries.set(id, entry);
            }
            entry.count++;
            add(entry.outcomes, call.outcome);
            if (call.error) add(entry.errors, call.error);
            for (const issue of call.issues ?? []) add(entry.issues, key(issue.path, issue.code));
            if (call.missingScope) add(entry.missingScope, call.missingScope);
            if (call.result) {
                entry.results++;
                if (call.result.bytes !== undefined) entry.bytes.push(call.result.bytes);
                if (call.result.more) entry.more++;
                if (call.result.remaining) entry.remaining++;
                if (call.result.truncated) entry.truncated++;
                if (call.result.itemErrors && Object.keys(call.result.itemErrors).length) {
                    entry.itemErrorCalls++;
                    for (const [code, count] of Object.entries(call.result.itemErrors)) add(entry.itemErrors, code, count);
                }
            }
            if (call.requestedName) add(requestedNames, key(call.method, call.requestedName));
            for (const argument of call.unknownArguments ?? []) add(unknownArguments, key(call.method, call.name, argument));
            if (call.failure) add(serverErrors, key(call.method, call.name, call.failure.name));
        }
    }

    const durations = stats(selected.map(event => event.durationMs));
    return {
        version: 1, dayUtc: day, environment,
        requests: { count: selected.length, outcomes: counts(outcomes), errors: counts(errors), authentication: counts(authentication),
            durationMs: durations && { p50: durations.median, p95: durations.p95, max: durations.max }, omittedCalls },
        connections: { refs: refs.size, users: users.size, refsByKind: { oauth: refsByKind.oauth.size, credential: refsByKind.credential.size } },
        clients: top(clients, TOP, ([name, version]) => ({ name, version })),
        calls: [...entries.values()].sort((a, b) => b.count - a.count || compare(key(a.method, a.name), key(b.method, b.name))).map(entry => ({
            method: entry.method, name: entry.name, count: entry.count, outcomes: counts(entry.outcomes), errors: counts(entry.errors),
            issues: top(entry.issues, TOP_ISSUES, ([path, code]) => ({ path, code })), missingScope: counts(entry.missingScope),
            result: entry.results ? { count: entry.results, bytes: stats(entry.bytes), more: entry.more, remaining: entry.remaining,
                truncated: entry.truncated, itemErrors: { calls: entry.itemErrorCalls, codes: counts(entry.itemErrors) } } : null,
        })),
        requestedNames: top(requestedNames, TOP, ([method, requestedName]) => ({ method, requestedName })),
        unknownArguments: top(unknownArguments, TOP, ([method, name, argument]) => ({ method, name, argument })),
        serverErrors: top(serverErrors, TOP, ([method, name, failure]) => ({ method, name, failure })),
        rejectedRecords, duplicateRecords,
        scope: 'Exported mcp_request events only. Platform log loss or sampling can leave gaps, and each request logs at most 10 calls (see omittedCalls).',
    };
}
