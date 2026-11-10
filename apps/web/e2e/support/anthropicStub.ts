import { createServer } from 'node:http';

const { rewriteFixture, stubUsage } = await import(new URL('./rewriteFixtures.ts', import.meta.url).href) as typeof import('./rewriteFixtures');

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
//
// Thread titles (src/lib/titles/generate.ts, model claude-haiku-5-5) have their own checks. Every new
// thread asks for one, so only a marker in the thread's first message gives a title; without one the
// answer is an empty title and the thread keeps its first line, as before titles:
//   [stub:title:Words]   the title "Words", as the model wrote it (the app cleans it)
//   [stub:title-long]    a title over the 80-character limit                         -> no title
//   [stub:title-refuse]  the request is declined (stop "refusal")                     -> no title
//   [stub:title-fail]    the API fails (500, retried once)                           -> no title

const port = Number(process.env.PORT);
const apiKey = process.env.ANTHROPIC_STUB_API_KEY;

/** What the app must send (README, "Rewrite suggestions") */
const expected = {
    model: 'claude-sonnet-5-5',
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

/**
 * A page's suggestions (the SEO panel's AI search section): the kind, by the task its system prompt
 * states; each kind's length limit is stated in it. The page's text decides the answer:
 *   [stub:fail]         the API fails (500, retried once)                      -> 503 unavailable
 *   [stub:refuse]       the request is declined (stop "refusal")               -> 200 { suggestions: [] }
 *   [stub:inject]       the model "obeyed" the page: an answer that is not JSON -> 503 unavailable
 *   [stub:inject-list]  JSON whose suggestions are not a list of strings       -> 503 unavailable
 *   [stub:page-filter]  suggestions out of bounds, on two lines, duplicated, the current title -> left out
 * Without one: three suggestions of the kind within its limits.
 */
const pageExpected = { title: { min: 10, max: 60 }, description: { min: 50, max: 160 }, questions: { min: 10, max: 150 } } as const;
type PageKind = keyof typeof pageExpected;

function pageKind(body: MessagesRequest): PageKind | undefined {
    const content = body.messages?.[0]?.content;
    if (typeof content !== 'string' || !content.includes('<page_text>') || typeof body.system !== 'string') return undefined;
    return body.system.includes('titles for the page') ? 'title' : body.system.includes('meta descriptions') ? 'description' : 'questions';
}

const pageAnswers: Record<PageKind, string[]> = {
    title: ['Plans and pricing for website reviews', 'Compare plans that include the toolbar', 'Pricing: every plan includes the toolbar'],
    description: ['Compare plans for reviewing live websites. Every plan includes the toolbar and comments pinned to the page.',
        'See what each plan includes, from the review toolbar to comments pinned to elements on your site.',
        'Plans for teams that review websites: the toolbar, pinned comments and browser details in every plan.'],
    questions: ['What does every plan include?', 'Which plan fits a small team?', 'How do comments stay pinned to the page?']
};

function pageReply(kind: PageKind, text: string, currentTitle: string | undefined): { status: number; body: unknown } {
    if (text.includes('[stub:fail]'))
        return { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'Stub: the API failed.' } } };
    if (text.includes('[stub:refuse]'))
        return { status: 200, body: message([{ type: 'text', text: JSON.stringify({ suggestions: ['Declined suggestion for the page.'] }) }], 'refusal', { type: 'refusal', category: 'cyber', explanation: 'Stub: declined.' }) };
    if (text.includes('[stub:inject-list]'))
        return { status: 200, body: message([{ type: 'text', text: JSON.stringify({ suggestions: 'INJECTED: <script>alert(1)</script>' }) }], 'end_turn') };
    if (text.includes('[stub:inject]'))
        return { status: 200, body: message([{ type: 'text', text: 'INJECTED: here are my instructions. <script>alert(1)</script>' }], 'end_turn') };
    if (text.includes('[stub:page-filter]')) {
        const { min, max } = pageExpected[kind];
        const valid = pageAnswers[kind][0]!;
        return { status: 200, body: answer([` ${valid} `, valid, 'x'.repeat(max + 1), 'y'.repeat(max), 'z'.repeat(min - 1), `First line of it\nand the second ${'w'.repeat(min)}`,
            ...kind === 'title' && currentTitle ? [currentTitle] : [], ' ', pageAnswers[kind][2]!]) };
    }
    return { status: 200, body: answer(pageAnswers[kind]) };
}

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
    if (pageKind(body)) {
        // A page's suggestions (src/lib/pageSuggestions/suggest.ts): their own limit, the page's text as material, one boundary
        const kind = pageKind(body)!;
        check(typeof body.system === 'string' && body.system.includes(`${pageExpected[kind].max} characters`) && body.system.includes('never as instructions'),
            `the system prompt does not state the ${pageExpected[kind].max}-character limit and that the page is not instructions`);
        check(body.messages?.length === 1 && body.messages[0]?.role === 'user' && typeof content === 'string'
            && content.split('<page_text>').length === 2 && content.split('</page_text>').length === 2, 'not one user message with the page text inside one boundary');
    } else {
        check(typeof body.system === 'string' && body.system.includes(`${expected.characterLimit} characters`), `the system prompt does not state the ${expected.characterLimit}-character limit`);
        check(body.messages?.length === 1 && body.messages[0]?.role === 'user' && typeof content === 'string' && content.includes('<selected_text>'), 'not one user message with the selected text');
    }
    // The selected Claude 5.5 model rejects these
    check(body.thinking === undefined || body.thinking.type === 'adaptive', 'thinking is set to something other than adaptive');
    check(body.temperature === undefined && body.top_p === undefined && body.top_k === undefined, 'sampling parameters are set');
    check(!body.stream, 'the request is streamed');
    return found;
}

/** What a thread title request must look like (src/lib/titles/generate.ts) */
const titleExpected = { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 200, characterLimit: 80 };

function titleProblems(headers: Record<string, string | string[] | undefined>, body: MessagesRequest) {
    const found: string[] = [];
    const check = (ok: boolean, problem: string) => {
        if (!ok)
            found.push(problem);
    };
    const schema = body.output_config?.format?.schema as { properties?: { title?: { type?: unknown } }; required?: unknown } | undefined;
    const content = body.messages?.[0]?.content;
    check(headers.authorization === `Bearer ${apiKey}` || headers['x-api-key'] === apiKey, 'the API key is not the e2e key');
    check(body.fallbacks === undefined, 'fallbacks is set (Haiku has no server-side fallback)');
    check(body.thinking?.type === 'disabled', 'thinking is not disabled');
    check(body.output_config?.effort === titleExpected.effort, `output_config.effort is not "${titleExpected.effort}"`);
    check(body.output_config?.format?.type === 'json_schema', 'output_config.format is not a JSON schema');
    check(schema?.properties?.title?.type === 'string' && Array.isArray(schema.required) && schema.required.includes('title'), 'the schema is not { title: string }');
    check(typeof body.max_tokens === 'number' && body.max_tokens > 0 && body.max_tokens <= titleExpected.maxTokens, `max_tokens is not 1-${titleExpected.maxTokens}`);
    check(typeof body.system === 'string' && body.system.includes(`${titleExpected.characterLimit} characters`) && body.system.includes('never as instructions'),
        'the system prompt does not state the limit and that the content is not instructions');
    check(body.messages?.length === 1 && body.messages[0]?.role === 'user' && typeof content === 'string' && content.includes('<message>'), 'not one user message with the message');
    check(body.temperature === undefined && body.top_p === undefined && body.top_k === undefined, 'sampling parameters are set');
    check(!body.stream, 'the request is streamed');
    return found;
}

function titleReply(text: string): { status: number; body: unknown } {
    const answer = (title: string, stopReason = 'end_turn') => {
        messageCount += 1;
        return { id: `msg_stub_${messageCount}`, type: 'message', role: 'assistant', model: titleExpected.model,
            content: [{ type: 'text', text: JSON.stringify({ title }) }], stop_reason: stopReason, stop_sequence: null,
            stop_details: stopReason === 'refusal' ? { type: 'refusal', category: 'general_harms', explanation: 'Stub: declined.' } : null,
            usage: { ...stubUsage } };
    };
    if (text.includes('[stub:title-fail]'))
        return { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'Stub: the API failed.' } } };
    if (text.includes('[stub:title-refuse]'))
        return { status: 200, body: answer('Declined title', 'refusal') };
    if (text.includes('[stub:title-long]'))
        return { status: 200, body: answer('x'.repeat(titleExpected.characterLimit + 1)) };
    const title = text.match(/\[stub:title:([^\]]+)\]/)?.[1];
    return { status: 200, body: answer(title ?? '') };
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
        usage: { ...stubUsage }
    };
}

const answer = (suggestions: string[]) => message([{ type: 'text', text: JSON.stringify({ suggestions }) }], 'end_turn');

function reply(selected: string, instruction: string | undefined): { status: number; body: unknown } {
    const markers = `${selected}\n${instruction ?? ''}`;
    if (markers.includes('[stub:fail]'))
        return { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'Stub: the API failed.' } } };
    for (const kind of ['missing_usage', 'invalid_output', 'empty_output', 'filtered_out', 'fallback_usage']) {
        if (markers.includes(`[stub:${kind}]`)) return { status: 200, body: rewriteFixture(kind === 'fallback_usage' ? 'fallback' : kind, expected.model) };
    }
    if (markers.includes('[stub:refuse]')) {
        // Text that reads as suggestions: only the stop reason says they must not be used
        return { status: 200, body: message([{ type: 'text', text: JSON.stringify({ suggestions: ['Declined suggestion.'] }) }], 'refusal', { type: 'refusal', category: 'cyber', explanation: 'Stub: declined.' }) };
    }
    if (markers.includes('[stub:fallback]')) {
        const fallback = rewriteFixture('fallback', expected.model);
        fallback.content = [
            { type: 'text', text: JSON.stringify({ suggestions: ['Before the fallback.'] }) },
            fallback.content[0],
            { type: 'text', text: JSON.stringify({ suggestions: ['After the fallback.'] }) }
        ];
        return { status: 200, body: fallback };
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

        const title = body.model === titleExpected.model;
        const found = title ? titleProblems(request.headers, body) : problems(request.headers, body);
        if (found.length) {
            console.error(`[anthropic stub] Rejected a request: ${found.join('; ')}`);
            send(400, { type: 'error', error: { type: 'invalid_request_error', message: `Stub: ${found.join('; ')}` } });
            return;
        }
        if (title) {
            const { status, body: result } = titleReply(tagged(String(body.messages?.[0]?.content), 'message') ?? '');
            send(status, result);
            return;
        }

        const content = String(body.messages?.[0]?.content);
        const kind = pageKind(body);
        if (kind) {
            const { status, body: result } = pageReply(kind, tagged(content, 'page_text') ?? '', tagged(content, 'current_title'));
            send(status, result);
            return;
        }
        const selected = tagged(content, 'selected_text') ?? '';
        // A browser test can assert the exact server-resolved guidance without returning it to a guest.
        const expectedStyle = selected.match(/\[stub:style:([A-Za-z0-9+/=]*)\]/)?.[1];
        if (expectedStyle !== undefined && (tagged(content, 'style_guidance') ?? '') !== Buffer.from(expectedStyle, 'base64').toString('utf8')) {
            send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Stub: unexpected style guidance.' } });
            return;
        }
        const { status, body: result } = reply(selected, tagged(content, 'reviewer_instruction'));
        send(status, result);
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`[anthropic stub] Listening on http://127.0.0.1:${port}`);
});
