import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { dailyMcpReport, mcpLogRecord } from '../src/lib/mcp/report';
import { mcpRequestEventSchema, type McpRequestEvent } from '../src/lib/mcp/telemetry';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/mcp-report.mjs', import.meta.url));
const day = '2026-11-04';
type Connection = NonNullable<McpRequestEvent['connection']>;
const oauth: Connection = { kind: 'oauth', ref: 'a1a1a1a1a1a1a1a1', user: 'b2b2b2b2b2b2b2b2', scopes: ['feedback:read'], access: 'all' };
const token: Connection = { kind: 'credential', ref: 'c3c3c3c3c3c3c3c3', user: 'b2b2b2b2b2b2b2b2', scopes: ['feedback:read', 'feedback:status'], access: 'selected' };
const other: Connection = { kind: 'credential', ref: 'd4d4d4d4d4d4d4d4', user: 'e5e5e5e5e5e5e5e5', scopes: ['feedback:read'], access: 'all' };
const frames = ['PRIVATE_FRAME (/var/task/apps/web/.next/server/chunks/1.js:2:3)'];
const event = (fields: Partial<McpRequestEvent> = {}): McpRequestEvent => ({ event: 'mcp_request', version: 1, id: randomUUID(),
    timestamp: `${day}T10:00:00.000Z`, environment: 'production', httpMethod: 'POST', status: 200, durationMs: 40, outcome: 'handled', calls: [], ...fields });
const list = (result: NonNullable<McpRequestEvent['calls'][number]['result']>) => ({ method: 'tools/call', name: 'list_feedback', outcome: 'success', result }) as const;
const initialize = (client: McpRequestEvent['client'], connection: McpRequestEvent['connection'], durationMs: number) => event({ client, connection, durationMs,
    protocolVersion: '2025-11-25', calls: [{ method: 'initialize', outcome: 'success' }, { method: 'notifications/initialized', outcome: 'accepted' }] });

const listing = event({ connection: oauth, durationMs: 100, calls: [list({ bytes: 1000, items: 5, more: true }), list({ bytes: 3000, items: 1, more: false })] });
const selected = [
    initialize({ name: 'claude-code', version: '2.1.0' }, oauth, 10),
    initialize({ name: 'claude-code', version: '2.1.0' }, token, 20),
    initialize({ name: 'cursor' }, other, 30),
    listing,
    event({ connection: token, calls: [{ method: 'tools/call', name: 'list_feedback', outcome: 'tool_error', error: 'invalid_arguments',
        arguments: { limit: 500, status: { type: 'string', length: 4 } }, unknownArguments: ['projectID'],
        issues: [{ path: 'limit', code: 'too_big' }, { path: 'status', code: 'invalid_value' }] }] }),
    event({ connection: token, calls: [{ method: 'tools/call', name: 'list_feedback', outcome: 'tool_error', error: 'invalid_arguments',
        unknownArguments: ['projectID', 'query'], issues: [{ path: 'limit', code: 'too_big' }] }, list({ bytes: 2000 })] }),
    event({ connection: oauth, calls: [{ method: 'tools/call', name: 'reply_to_feedback', outcome: 'tool_error', error: 'forbidden', missingScope: 'feedback:reply' },
        { method: 'tools/call', name: 'unknown', requestedName: 'create_issue', outcome: 'tool_error', error: 'unknown_tool' },
        { method: 'tools/call', name: 'unknown', requestedName: 'create_issue', outcome: 'tool_error', error: 'unknown_tool' },
        { method: 'prompts/get', name: 'unknown', requestedName: 'triage', outcome: 'error', rpcError: -32602, error: 'unknown_prompt' }] }),
    event({ connection: oauth, omittedCalls: 3, calls: [{ method: 'tools/call', name: 'get_feedback_batch', outcome: 'success',
        result: { bytes: 250_000, items: 7, remaining: 2, truncated: true, itemErrors: { not_found: 2, forbidden: 1 } } },
    { method: 'tools/call', name: 'get_feedback_batch', outcome: 'success', result: { bytes: 4000, items: 2, remaining: 0 } },
    { method: 'resources/read', name: 'feedback_screenshot', outcome: 'success', result: { bytes: 50_000 } },
    { method: 'tools/call', name: 'get_feedback', outcome: 'error', rpcError: -32603, error: 'server_error', failure: { name: 'TypeError', frames } }] }),
    event({ status: 401, durationMs: 2, outcome: 'rejected', error: 'sign_in_required', authentication: 'missing',
        calls: [{ method: 'tools/call', name: 'list_feedback', outcome: 'unanswered' }] }),
    event({ status: 401, durationMs: 3, outcome: 'rejected', error: 'sign_in_required', authentication: 'invalid', calls: [] }),
    event({ status: 500, durationMs: 900, outcome: 'failed', error: 'server_error', failure: { name: 'RestError', status: 503, frames }, connection: other, calls: [] }),
    event({ status: 200, durationMs: 25_000, outcome: 'interrupted', error: 'timeout', connection: other,
        calls: [{ method: 'tools/call', name: 'list_feedback', outcome: 'unanswered' }] }),
] satisfies McpRequestEvent[];
const skipped = [
    event({ timestamp: '2026-11-03T23:59:59.999Z', client: { name: 'other-day' }, calls: [{ method: 'initialize', outcome: 'success' }] }),
    event({ environment: 'preview', client: { name: 'preview-client' }, calls: [{ method: 'initialize', outcome: 'success' }] }),
];
const invalid = [{ ...event(), text: 'PRIVATE_FEEDBACK_TEXT' }, { ...event(), version: 2 }, { ...event(), client: { name: 'PRIVATE_'.repeat(20) } }];
const vercel = (message: unknown) => JSON.stringify({ id: 'PRIVATE_LOG_ID', level: 'info', source: 'lambda', requestPath: '/api/mcp',
    message: typeof message === 'string' ? message : JSON.stringify(message) });
const lines = [
    ...selected.slice(0, 6).map(entry => JSON.stringify(entry)),
    ...selected.slice(6).map(vercel),
    JSON.stringify(listing), vercel(listing),
    ...[...skipped, ...invalid].map(entry => JSON.stringify(entry)),
    '', '   ', 'PRIVATE plain text line', vercel('PRIVATE message that is not JSON'), '{"event":"mcp_request", PRIVATE broken',
    JSON.stringify({ event: 'rewrite_usage', text: 'PRIVATE' }), vercel({ event: 'rewrite_usage' }), 'null', '[1,2]', '42',
];
const records = () => lines.map(mcpLogRecord).filter(record => record !== undefined);

test('fixture events follow the event contract', () => {
    for (const entry of [...selected, ...skipped]) expect(mcpRequestEventSchema.safeParse(entry).success).toBe(true);
    for (const entry of invalid) expect(mcpRequestEventSchema.safeParse(entry).success).toBe(false);
});

test('reads raw events and Vercel log objects, and skips every other line', () => {
    expect(mcpLogRecord(JSON.stringify(listing))).toEqual(listing);
    expect(mcpLogRecord(vercel(listing))).toEqual(listing);
    for (const line of ['', 'PRIVATE plain text', vercel('PRIVATE not JSON'), vercel({ event: 'rewrite_usage' }), '{"event":"mcp_request"', 'null', '[1,2]', '"mcp_request"'])
        expect(mcpLogRecord(line)).toBeUndefined();
    // Invalid events reach the report, which counts and skips them.
    expect(records()).toHaveLength(selected.length + 2 + skipped.length + invalid.length);
});

test('summarizes one day and environment by request, call, client and connection', () => {
    const report = dailyMcpReport(records(), day, 'production');
    expect(report).toMatchObject({ version: 1, dayUtc: day, environment: 'production', rejectedRecords: 3, duplicateRecords: 2 });
    expect(report.requests).toEqual({ count: 12, outcomes: { handled: 8, rejected: 2, failed: 1, interrupted: 1 },
        errors: { sign_in_required: 2, server_error: 1, timeout: 1 }, authentication: { invalid: 1, missing: 1 },
        durationMs: { p50: 40, p95: 25_000, max: 25_000 }, omittedCalls: 3 });
    expect(report.connections).toEqual({ refs: 3, users: 2, refsByKind: { oauth: 1, credential: 2 } });
    expect(report.clients).toEqual([{ name: 'claude-code', version: '2.1.0', count: 2 }, { name: 'cursor', version: null, count: 1 }]);
    expect(report.calls.map(({ method, name, count }) => [method, name, count])).toEqual([
        ['tools/call', 'list_feedback', 7], ['initialize', null, 3], ['notifications/initialized', null, 3], ['tools/call', 'get_feedback_batch', 2],
        ['tools/call', 'unknown', 2], ['prompts/get', 'unknown', 1], ['resources/read', 'feedback_screenshot', 1], ['tools/call', 'get_feedback', 1],
        ['tools/call', 'reply_to_feedback', 1]]);
    const call = (method: string, name: string | null) => report.calls.find(entry => entry.method === method && entry.name === name)!;
    expect(call('tools/call', 'list_feedback')).toEqual({ method: 'tools/call', name: 'list_feedback', count: 7,
        outcomes: { success: 3, tool_error: 2, unanswered: 2 }, errors: { invalid_arguments: 2 },
        issues: [{ path: 'limit', code: 'too_big', count: 2 }, { path: 'status', code: 'invalid_value', count: 1 }], missingScope: {},
        result: { count: 3, bytes: { median: 2000, p95: 3000, max: 3000 }, more: 1, remaining: 0, truncated: 0, itemErrors: { calls: 0, codes: {} } } });
    expect(call('tools/call', 'get_feedback_batch').result).toEqual({ count: 2, bytes: { median: 4000, p95: 250_000, max: 250_000 },
        more: 0, remaining: 1, truncated: 1, itemErrors: { calls: 1, codes: { not_found: 2, forbidden: 1 } } });
    expect(call('tools/call', 'reply_to_feedback')).toMatchObject({ errors: { forbidden: 1 }, missingScope: { 'feedback:reply': 1 }, result: null });
    expect(call('resources/read', 'feedback_screenshot').result).toMatchObject({ count: 1, bytes: { median: 50_000, p95: 50_000, max: 50_000 } });
    expect(call('initialize', null)).toMatchObject({ outcomes: { success: 3 }, result: null });
    expect(report.requestedNames).toEqual([{ method: 'tools/call', requestedName: 'create_issue', count: 2 },
        { method: 'prompts/get', requestedName: 'triage', count: 1 }]);
    expect(report.unknownArguments).toEqual([{ method: 'tools/call', name: 'list_feedback', argument: 'projectID', count: 2 },
        { method: 'tools/call', name: 'list_feedback', argument: 'query', count: 1 }]);
    expect(report.serverErrors).toEqual([{ method: 'tools/call', name: 'get_feedback', failure: 'TypeError', count: 1 },
        { method: null, name: null, failure: 'RestError', count: 1 }]);
});

test('the report holds no content, ids, references or code locations', () => {
    const output = JSON.stringify(dailyMcpReport(records(), day, 'production'));
    for (const value of ['PRIVATE', '/var/task', oauth.ref, oauth.user, token.ref, other.ref, other.user, ...selected.map(entry => entry.id)])
        expect(output).not.toContain(value);
});

test('an empty day reports zero counts, and an invalid day is refused', () => {
    expect(dailyMcpReport(records(), '2026-11-05', 'production')).toMatchObject({ requests: { count: 0, outcomes: {}, durationMs: null, omittedCalls: 0 },
        connections: { refs: 0, users: 0 }, clients: [], calls: [], requestedNames: [], unknownArguments: [], serverErrors: [], rejectedRecords: 3 });
    expect(dailyMcpReport(records(), day, 'preview')).toMatchObject({ requests: { count: 1 }, clients: [{ name: 'preview-client', version: null, count: 1 }] });
    for (const value of ['2026-11-4', '2026-13-01', 'yesterday']) expect(() => dailyMcpReport([], value, 'production')).toThrow('Invalid UTC day');
});

test('the command prints the report for an export file and never echoes log lines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-mcp-report-'));
    try {
        const file = join(directory, 'logs.ndjson');
        await writeFile(file, `${lines.join('\r\n')}\n`);
        const run = (...args: string[]) => execute(process.execPath, [script, ...args]).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
            (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
        const result = await run(file, day, 'production');
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(dailyMcpReport(records(), day, 'production'));
        for (const [args, message] of [[[file, day], /^Usage: /], [[file, '2026-02-30x', 'production'], /^Usage: /], [[file, day, 'staging'], /^Usage: /],
            [[join(directory, 'missing.ndjson'), day, 'production'], /^MCP report failed\. .*No log content was printed\.\n$/]] as const) {
            const failed = await run(...args);
            expect(failed).toMatchObject({ code: 1, stdout: '' });
            expect(failed.stderr).toMatch(message);
        }
        expect(result.stdout + result.stderr).not.toContain('PRIVATE');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
