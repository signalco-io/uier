import { createServer } from 'node:https';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';
import { port } from './environment';
import type { AddressInfo } from 'node:net';

/** Native identity windows bypass Playwright routes. DNS maps the packaged API to this TLS proxy. */
export async function packageApiProxy(directory: string) {
    const key = resolve(directory, 'loopback.key'), cert = resolve(directory, 'loopback.crt'), config = resolve(directory, 'loopback.cnf');
    await writeFile(config, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=uier.io\n[v3]\nsubjectAltName=DNS:uier.io\n');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', config], { stdio: 'ignore' });
    const certificate = await readFile(cert), privateKey = await readFile(key);
    const spki = createHash('sha256').update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const requests: { path: string; hasCookie: boolean }[] = [];
    let dropWrite = false;
    let dropRefresh = false;
    let heldRefresh: { received: () => void; release: Promise<void> } | undefined;
    const server = createServer({ key: privateKey, cert: certificate }, (incoming, response) => {
        if (!['uier.io', 'uier.io:443'].includes(incoming.headers.host ?? '')) { response.writeHead(421).end(); return; }
        requests.push({ path: incoming.url ?? '', hasCookie: Boolean(incoming.headers.cookie) });
        const write = dropWrite && incoming.method === 'POST' && incoming.url === '/api/extension/review/comments';
        const refresh = dropRefresh && incoming.method === 'POST' && incoming.url === '/api/extension/refresh';
        const drop = write || refresh;
        if (write) dropWrite = false;
        if (refresh) dropRefresh = false;
        const hold = incoming.url === '/api/extension/refresh' ? heldRefresh : undefined;
        if (hold) heldRefresh = undefined;
        const upstream = request({ hostname: '127.0.0.1', port, path: incoming.url, method: incoming.method,
            headers: { ...incoming.headers, host: 'uier.io', 'x-forwarded-proto': 'https' } }, result => {
            if (drop) {
                result.resume(); result.on('end', () => {
                    response.writeHead(result.statusCode ?? 200, { 'Content-Type': 'application/json', 'Content-Length': '1000000' });
                    response.write('{'); setImmediate(() => response.destroy());
                }); return;
            }
            const forward = () => { response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response); };
            if (hold) { hold.received(); void hold.release.then(forward); }
            else forward();
        });
        upstream.setTimeout(30_000, () => upstream.destroy());
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
        incoming.pipe(upstream);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    return { requests, dropNextReviewWrite: () => { dropWrite = true; }, dropNextRefreshResponse: () => { dropRefresh = true; }, port: (server.address() as AddressInfo).port, spki,
        holdNextRefreshResponse() {
            let received!: () => void, release!: () => void;
            const ready = new Promise<void>(resolve => { received = resolve; });
            const wait = new Promise<void>(resolve => { release = resolve; });
            heldRefresh = { received, release: wait };
            return { ready, release };
        },
        close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
