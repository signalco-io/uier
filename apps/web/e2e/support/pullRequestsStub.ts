import { createServer } from 'node:http';

// Public PR state only. Browser tests never contact a live provider, even for a missing/private PR.
const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://127.0.0.1').pathname;
    response.setHeader('Content-Type', 'application/json');
    if (path === '/') { response.end('{"ready":true}'); return; }
    if (request.method !== 'GET' || request.headers.authorization) { response.writeHead(403); response.end('{}'); return; }
    const id = Number(path.split('/').at(-1));
    if (id < 1 || id > 4) { response.writeHead(404); response.end('{}'); return; }
    const github = path.startsWith('/github/repos/acme/site/pulls/');
    const gitlab = path.startsWith('/gitlab/projects/acme%2Fsite/merge_requests/');
    if (!github && !gitlab) { response.writeHead(404); response.end('{}'); return; }
    response.end(JSON.stringify(github ? { number: id, state: id === 2 || id === 3 ? 'closed' : 'open', merged: id === 2, draft: id === 4 }
        : { iid: id, state: id === 2 ? 'merged' : id === 3 ? 'closed' : 'opened', draft: id === 4 }));
});
server.listen(Number(process.env.PORT), '127.0.0.1');
