import { createServer } from 'node:http';

// A stand-in for the Anthropic Messages API in the e2e tests: playwright.config.ts starts it
// (`node e2e/support/anthropicStub.ts`) and points the app's ANTHROPIC_BASE_URL at it, with a fake
// ANTHROPIC_API_KEY. It checks the request rewrite suggestions make (src/lib/rewrite/suggest.ts)
// and answers like the API, with canned structured output. A request that fails a check gets a
// `400` like the API's, which the app answers with `503 unavailable` (and the reason is logged here).
//
// A marker in the selected text or the instruction picks the answer:
//   [stub:fail]      the API fails (500, retried once)          -> 503 unavailable
//   [stub:refuse]    the request is declined (stop "refusal"), with partial suggestions -> 200 { suggestions: [] }
//   [stub:fallback]  a model declined and the fallback model answered: only the text after the
//                    `fallback` block is the answer                                -> its suggestions
//   [stub:truncate]  the answer is cut off (stop "max_tokens")   -> 200 { suggestions: [] }
//   [stub:filter]    duplicates, the original, an empty and a too long suggestion -> left out
// Without one: "First suggestion.", "Second suggestion.", "Third suggestion." (with the instruction
// in brackets before the period, "First suggestion (Shorter).").

const port = Number(process.env.PORT);
const apiKey = process.env.ANTHROPIC_STUB_API_KEY;

/** What the app must send (README, "Rewrite suggestions") */
const expected = {
    model: 'claude-opus-5-5',
    beta: 'server-side-fallback-2026-07-01',
    effort: 'low',
    maxTokens: 4096,
    /** A rewrite comment's text limit, stated in the system prompt as a hard limit */
    characterLimit: 1000
};

type MessagesRequest = {
    model?: unknown;
    max_tokens?: unknown;
    fallbacks?: unknown;
    output_config?: { effort?: unknown; format?: { type?: unknown; schema?: { properties?: { suggestions?: { type?: unknown; items?: { type?: unknown } } }; required?: unknown } } };
    system?: unknown;
    messages?: { role?: unknown; content?: unknown }[];
    thinking?: { type?: unknown };
    stream?: unknown;
    temperature?: unknown;
    top_p?: unknown;
    top_k?: unknown;
};

function problems(headers: Record<string, string | string[] | undefined>, body: MessagesRequest) {
    const found: string[] = [];
    const check = (ok: boolean, problem: string) => {
        if (!ok)
            found.push(problem);
    };
    const betas = String(headers['anthropic-beta'] ?? '').split(',').map(beta => beta.trim());
    const schema = body.output_config?.format?.schema;
    const content = body.messages?.[0]?.content;

    // The SDK sends the key as a bearer token (older versions as x-api-key)
    check(headers.authorization === `Bearer ${apiKey}` || headers['x-api-key'] === apiKey, 'the API key is not the e2e key');
    check(betas.includes(expected.beta), `anthropic-beta does not include ${expected.beta}`);
    check(body.model === expected.model, `model is ${String(body.model)}, not ${expected.model}`);
    check(body.fallbacks === 'default', 'fallbacks is not "default"');
    check(body.output_config?.effort === expected.effort, `output_config.effort is not "${expected.effort}"`);
    check(body.output_config?.format?.type === 'json_schema', 'output_config.format is not a JSON schema');
    check(schema?.properties?.suggestions?.type === 'array' && schema.properties.suggestions.items?.type === 'string'
        && Array.isArray(schema.required) && schema.required.includes('suggestions'), 'the schema is not { suggestions: string[] }');
    check(typeof body.max_tokens === 'number' && body.max_tokens > 0 && body.max_tokens <= expected.maxTokens, `max_tokens is not 1-${expected.maxTokens}`);
    check(typeof body.system === 'string' && body.system.includes(`${expected.characterLimit} characters`), `the system prompt does not state the ${expected.characterLimit}-character limit`);
    check(body.messages?.length === 1 && body.messages[0]?.role === 'user' && typeof content === 'string' && content.includes('<selected_text>'), 'not one user message with the selected text');
    // Claude Opus 5.5 rejects these
    check(body.thinking === undefined || body.thinking.type === 'adaptive', 'thinking is set to something other than adaptive');
    check(body.temperature === undefined && body.top_p === undefined && body.top_k === undefined, 'sampling parameters are set');
    check(!body.stream, 'the request is streamed');
    return found;
}

function tagged(content: string, tag: string) {
    return content.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1];
}

let messageCount = 0;

function message(content: unknown[], stopReason: string, stopDetails: unknown = null) {
    messageCount += 1;
    return {
        id: `msg_stub_${messageCount}`,
        type: 'message',
        role: 'assistant',
        model: expected.model,
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        stop_details: stopDetails,
        usage: { input_tokens: 120, output_tokens: 60 }
    };
}

const answer = (suggestions: string[]) => message([{ type: 'text', text: JSON.stringify({ suggestions }) }], 'end_turn');

function reply(selected: string, instruction: string | undefined): { status: number; body: unknown } {
    const markers = `${selected}\n${instruction ?? ''}`;
    if (markers.includes('[stub:fail]'))
        return { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'Stub: the API failed.' } } };
    if (markers.includes('[stub:refuse]')) {
        // Text that reads as suggestions: only the stop reason says they must not be used
        return { status: 200, body: message([{ type: 'text', text: JSON.stringify({ suggestions: ['Declined suggestion.'] }) }], 'refusal', { type: 'refusal', category: 'cyber', explanation: 'Stub: declined.' }) };
    }
    if (markers.includes('[stub:fallback]')) {
        return {
            status: 200,
            body: message([
                { type: 'text', text: JSON.stringify({ suggestions: ['Before the fallback.'] }) },
                { type: 'fallback', from: { model: expected.model }, to: { model: 'claude-fallback-stub' }, trigger: { type: 'refusal', category: 'cyber' } },
                { type: 'text', text: JSON.stringify({ suggestions: ['After the fallback.'] }) }
            ], 'end_turn')
        };
    }
    if (markers.includes('[stub:truncate]'))
        return { status: 200, body: message([{ type: 'text', text: '{"suggestions":["Cut off' }], 'max_tokens') };
    if (markers.includes('[stub:filter]')) {
        return {
            status: 200,
            body: answer(['Same text.', '  Same text.  ', selected, ' ', 'x'.repeat(expected.characterLimit + 1), 'y'.repeat(expected.characterLimit), 'Third.', 'Fourth.'])
        };
    }

    const note = instruction ? ` (${instruction})` : '';
    return { status: 200, body: answer([`First suggestion${note}.`, `Second suggestion${note}.`, `Third suggestion${note}.`]) };
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'request-id': `req_stub_${Date.now()}` });
        response.end(JSON.stringify(body));
    };

    // Playwright waits for this before the tests start
    if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('Anthropic API stub');
        return;
    }
    // BotID's response/header tests share this local server; no real challenge is requested.
    if (url.pathname === '/v1/challenge') {
        response.writeHead(200, { 'Content-Type': 'application/javascript' });
        response.end('window.__botIdFixture = true;');
        return;
    }
    if (url.pathname.startsWith('/v1/proxy/')) {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => send(200, { method: request.method, path: url.pathname,
            query: url.search, forwardedHost: request.headers['x-forwarded-host'], body: Buffer.concat(chunks).toString('utf8') }));
        return;
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') {
        send(404, { type: 'error', error: { type: 'not_found_error', message: `Stub: no ${request.method} ${url.pathname}` } });
        return;
    }

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
        let body: MessagesRequest;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MessagesRequest;
        } catch {
            send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Stub: the body is not JSON.' } });
            return;
        }

        const found = problems(request.headers, body);
        if (found.length) {
            console.error(`[anthropic stub] Rejected a request: ${found.join('; ')}`);
            send(400, { type: 'error', error: { type: 'invalid_request_error', message: `Stub: ${found.join('; ')}` } });
            return;
        }

        const content = String(body.messages?.[0]?.content);
        const { status, body: result } = reply(tagged(content, 'selected_text') ?? '', tagged(content, 'reviewer_instruction'));
        send(status, result);
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`[anthropic stub] Listening on http://127.0.0.1:${port}`);
});
