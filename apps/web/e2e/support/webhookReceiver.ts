import { createHmac, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ReceivedWebhook = { headers: IncomingHttpHeaders; body: string; json: Record<string, any> };

export const newWebhookSecret = () => `whsec_${randomBytes(32).toString('base64')}`;

/**
 * An MCP event webhook endpoint on http://127.0.0.1 (accepted only with
 * `UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` in local runtime). It answers the verification
 * challenge and checks Standard Webhooks signatures against the secrets it was given.
 */
export class WebhookReceiver {
    readonly received: ReceivedWebhook[] = [];
    readonly secrets = new Set<string>();
    /** Status for event deliveries */
    status = 200;
    /** Whether verification challenges are echoed */
    echo = true;
    /** Path prefixes published in `/.well-known/mcp-webhook-receiver.json`; none: the document is not served */
    receivers?: string[];
    /** How often that document was asked for */
    documentRequests = 0;
    url = '';
    private server?: Server;

    async start() {
        this.server = createServer((request, response) => {
            if (request.method === 'GET') {
                if (request.url === '/.well-known/mcp-webhook-receiver.json') this.documentRequests++;
                const published = request.url === '/.well-known/mcp-webhook-receiver.json' && this.receivers;
                response.writeHead(published ? 200 : 404, { 'Content-Type': 'application/json' });
                response.end(published ? JSON.stringify({ receivers: this.receivers }) : '{}');
                return;
            }
            const chunks: Buffer[] = [];
            request.on('data', chunk => chunks.push(chunk));
            request.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const json = JSON.parse(body) as Record<string, any>;
                this.received.push({ headers: request.headers, body, json });
                if (json.type === 'verification') {
                    response.writeHead(this.echo ? 200 : 202, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify(this.echo ? { challenge: json.challenge } : {}));
                    return;
                }
                response.writeHead(this.status);
                response.end();
            });
        });
        await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/hooks/${randomUUID()}`;
        return this;
    }

    stop() { return new Promise(resolve => this.server ? this.server.close(resolve) : resolve(undefined)); }

    /** Whether the request carries the server's own `v1a,` signature for this public key (a JWK from the Server Card) */
    signedBy(entry: ReceivedWebhook, jwk: Record<string, unknown>) {
        const signature = String(entry.headers['webhook-signature']).split(' ').find(value => value.startsWith('v1a,'));
        if (!signature) return false;
        const signed = Buffer.from(`${String(entry.headers['webhook-id'])}.${String(entry.headers['webhook-timestamp'])}.${entry.body}`);
        return verify(null, signed, createPublicKey({ key: jwk as never, format: 'jwk' }), Buffer.from(signature.slice(4), 'base64'));
    }

    /** The registered secrets whose signature this request carries */
    verifiedBy(entry: ReceivedWebhook) {
        const id = String(entry.headers['webhook-id']);
        const timestamp = String(entry.headers['webhook-timestamp']);
        const signatures = String(entry.headers['webhook-signature']).split(' ');
        return [...this.secrets].filter(secret => {
            const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
            return signatures.includes(`v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${entry.body}`).digest('base64')}`);
        });
    }

    /** Event deliveries (not verification requests), optionally of one event name */
    deliveries(name?: string) { return this.received.filter(entry => entry.json.type === undefined && (!name || entry.json.name === name)); }
}
