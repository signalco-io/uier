import { expect } from '@playwright/test';

export type StreamMessage = Record<string, any>;

/** The `_meta` every 2026-07-28 request carries in place of a handshake */
export const modernEnvelope = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'events-modern', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {} };
export const SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId';

/** The JSON-RPC messages of an SSE response as they arrive: read until something was seen, or to the end. */
export function streamOf(response: Response) {
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const messages: StreamMessage[] = [];
    /** SSE comment lines (`: keepalive`): a push stream has none, its heartbeats are messages */
    const comments: string[] = [];
    let buffer = '';
    let ended = false;
    const read = async () => {
        const { done, value } = await reader.read();
        if (done) { ended = true; return; }
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const lines = buffer.slice(0, end).split('\n');
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
            comments.push(...lines.filter(line => line.startsWith(':')));
            buffer = buffer.slice(end + 2);
            if (data) messages.push(JSON.parse(data) as StreamMessage);
        }
    };
    return {
        messages, comments,
        async until(seen: (messages: StreamMessage[]) => boolean) { while (!ended && !seen(messages)) await read(); expect(seen(messages)).toBe(true); return messages; },
        async end() { while (!ended) await read(); return messages; }
    };
}

/** The params of the stream's `notifications/events/<method>` messages */
export const named = (messages: StreamMessage[], method: string) =>
    messages.filter(message => message.method === `notifications/events/${method}`).map(message => message.params as StreamMessage);
