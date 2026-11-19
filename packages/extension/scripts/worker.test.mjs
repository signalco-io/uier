import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

// The worker's saved project attempts, in the real worker (src/worker.ts) with the browser's storage, tabs and
// identity and uier's API replaced by stand-ins this test controls. No browser and no network.

const compiled = build({
    entryPoints: [resolve(import.meta.dirname, '../src/worker.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    define: { __EXTENSION_BROWSER__: '"chrome"', __EXTENSION_API__: '"https://uier.io"' }
});
const extension = 'chrome-extension://extension-id';
const site = 'https://site.example';

const turn = () => new Promise(resolve => setTimeout(resolve, 1));
function storageArea() {
    const values = new Map();
    return { values,
        async setAccessLevel() {},
        // Every read and write crosses to the browser and back, as the real ones do: slower than anything the
        // worker computes, so two callers that read before either writes both see the old state
        async get(keys) {
            await turn();
            if (keys === null || keys === undefined) return Object.fromEntries(values);
            return Object.fromEntries([keys].flat().filter(key => values.has(key)).map(key => [key, structuredClone(values.get(key))]));
        },
        async set(items) { await turn(); for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value)); },
        async remove(keys) { await turn(); for (const key of [keys].flat()) values.delete(key); },
        async clear() { await turn(); values.clear(); }
    };
}

/** A worker signed in as `session-a`, with two windows each showing the site in its active tab */
async function worker() {
    const session = storageArea(), local = storageArea();
    session.values.set('extension-session-v1', { id: 'session-a', token: 'token-a', expiresAt: Date.now() + 600_000 });
    const tabs = new Map([[1, { id: 1, windowId: 1, active: true, url: `${site}/a` }], [2, { id: 2, windowId: 2, active: true, url: `${site}/b` }]]);
    const listeners = [], requests = [];
    const event = { addListener() {}, removeListener() {} };
    const chrome = {
        runtime: { id: 'extension-id', getURL: path => `${extension}/${path}`, getManifest: () => ({ version: '0.1.9' }), reload() {},
            onMessage: { addListener: listener => listeners.push(listener), removeListener() {} }, onUpdateAvailable: event, async requestUpdateCheck() { return { status: 'no_update' }; } },
        tabs: { onActivated: event, onRemoved: event, onUpdated: event, async query() { return [tabs.get(1)]; }, async get(id) { return tabs.get(id); }, async sendMessage() {} },
        storage: { session, local },
        action: { async setIcon() {} },
        identity: { getRedirectURL: () => 'https://extension-id.chromiumapp.org/uier',
            // Consent approves at once and hands back the state it was given
            async launchWebAuthFlow({ url }) { return `https://extension-id.chromiumapp.org/uier?state=${new URL(url).searchParams.get('state')}&code=${'c'.repeat(43)}`; } }
    };
    // uier: each test answers the requests it expects, in the order it chooses
    const api = { answer: () => { throw new Error('No answer set'); } };
    const fetch = async (url, init = {}) => {
        const request = { path: new URL(url).pathname.replace('/api/extension/', '') + new URL(url).search, method: init.method ?? 'GET', token: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined };
        requests.push(request);
        return api.answer(request);
    };
    const module = { exports: {} };
    runInNewContext((await compiled).outputFiles[0].text, { module, exports: module.exports, chrome, fetch, URL, URLSearchParams, TextEncoder, crypto, btoa, atob, setTimeout, clearTimeout, Response, console });
    // Answers cross from the worker's realm: copied, so they compare as plain values
    const send = message => new Promise(done => listeners[0](message, { id: 'extension-id', url: `${extension}/popup.html` }, answer => done(JSON.parse(JSON.stringify(answer)))));
    const attempts = () => [...session.values].filter(([key]) => key.startsWith('project-attempt:v1:')).map(([, value]) => value);
    return { send, api, requests, session, attempts, creates: () => requests.filter(request => request.path === 'projects' && request.method === 'POST') };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const project = { id: 'public-id', projectId: 'abcdefghijkl', name: 'Site', access: 'invited', workspaceId: 'w_1', workspaceName: 'Personal' };
const submission = { type: 'create-project', origin: site, name: 'Site', workspaceId: 'w_1' };
/** uier's usual answers: the project for a create, nothing to start a review with (the test is not about reviews) */
const usual = request => request.path === 'projects' && request.method === 'POST' ? json(project, 201)
    : request.path.startsWith('projects?') ? json({ projects: [], workspaces: [{ id: 'w_1', name: 'Personal' }], canSetUp: true })
        : request.path === 'session' ? new Response(null, { status: 204 })
            : json({ error: 'forbidden', message: 'No review in this test.' }, 403);

test('two windows sending one submission at once share one attempt', async () => {
    const current = await worker();
    current.api.answer = usual;
    const answers = await Promise.all([current.send({ ...submission, tabId: 1 }), current.send({ ...submission, tabId: 2 })]);
    assert.deepEqual(answers.map(answer => answer.ok && answer.value.project.projectId), [project.projectId, project.projectId]);
    const sent = current.creates();
    assert.equal(sent.length, 2);
    assert.match(sent[0].body.attempt, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(sent[1].body.attempt, sent[0].body.attempt);
    assert.deepEqual(sent.map(request => request.body.origin), [site, site]);
    // One record, for the one submission; another name is another submission with its own
    assert.deepEqual(current.attempts().map(record => record.attempt), [sent[0].body.attempt]);
    await current.send({ ...submission, tabId: 1, name: 'Another' });
    assert.equal(current.attempts().length, 2);
    assert.notEqual(current.creates()[2].body.attempt, sent[0].body.attempt);
});

/** Signs the worker in again as another account (`token-b`): consent approves at once */
async function signInAgain(current, others = usual) {
    current.api.answer = request => request.path === 'token' ? json({ token: 'token-b', expiresAt: Date.now() + 600_000, refreshToken: 'refresh-b', refreshExpiresAt: Date.now() + 86_400_000 })
        : others(request);
    assert.deepEqual(await current.send({ type: 'sign-in' }), { ok: true });
    assert.notEqual(current.session.values.get('extension-session-v1').id, 'session-a');
}

test('discovery in one popup leaves the attempt another popup still needs', async () => {
    const current = await worker();
    // Two windows show the form and send it. uier commits once; the answer to the request that arrives second is
    // lost on the way. Either window's may be that one: each computes its record's key before it is sent
    let lose = true;
    current.api.answer = request => request.path === 'projects' && request.method === 'POST' && request.body && lose && current.creates().length === 2
        ? Promise.reject(new TypeError('Failed to fetch')) : usual(request);
    const answers = await Promise.all([current.send({ ...submission, tabId: 1 }), current.send({ ...submission, tabId: 2 })]);
    assert.deepEqual(answers.map(answer => answer.ok).sort(), [false, true]);
    assert.equal(answers.find(answer => answer.ok).value.project.projectId, project.projectId);
    const lost = answers[0].ok ? 2 : 1;
    const [sent] = current.creates();
    // The popup that got its answer refreshes and sees the project in its list
    current.api.answer = request => request.path.startsWith('projects?') ? json({ projects: [project], workspaces: [], canSetUp: true }) : usual(request);
    assert.deepEqual((await current.send({ type: 'state' })).value.projects, [project]);
    assert.deepEqual(current.attempts(), [{ attempt: sent.body.attempt }]);
    // The other popup's own refresh fails, so its form is still there. Its retry is the same request, now and later
    lose = false;
    current.api.answer = request => request.path.startsWith('projects?') ? Promise.reject(new TypeError('Failed to fetch')) : usual(request);
    assert.equal((await current.send({ type: 'state' })).ok, false);
    assert.equal((await current.send({ ...submission, tabId: lost })).value.project.projectId, project.projectId);
    assert.equal((await current.send({ ...submission, tabId: lost })).value.project.projectId, project.projectId);
    assert.deepEqual(current.creates().map(request => request.body.attempt), Array(4).fill(sent.body.attempt));
    assert.deepEqual(current.attempts(), [{ attempt: sent.body.attempt }]);
});

test('a discovery answer of an earlier sign-in leaves the next sign-in\'s attempt alone', async () => {
    const current = await worker();
    // The first sign-in asks uier for the site's projects; the answer is on its way
    let arrive;
    const delayed = new Promise(resolve => { arrive = resolve; });
    current.api.answer = request => request.path.startsWith('projects?') ? delayed : usual(request);
    const discovery = current.send({ type: 'state' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(current.requests.map(request => [request.path, request.token]), [[`projects?origin=${encodeURIComponent(site)}`, 'Bearer token-a']]);

    // Meanwhile the person signs in again, and that sign-in's create is committed by uier but its answer is lost
    await signInAgain(current);
    current.api.answer = request => request.path === 'projects' && request.method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : usual(request);
    assert.equal((await current.send({ ...submission, tabId: 1 })).ok, false);
    const [lost] = current.creates();
    assert.equal(lost.token, 'Bearer token-b');
    assert.deepEqual(current.attempts(), [{ attempt: lost.body.attempt }]);

    // Now the old answer arrives, listing that very project. It says nothing to the new sign-in's records
    arrive(json({ projects: [project], workspaces: [], canSetUp: true }));
    assert.equal((await discovery).ok, true);
    assert.deepEqual(current.attempts(), [{ attempt: lost.body.attempt }]);
    current.api.answer = usual;
    assert.equal((await current.send({ ...submission, tabId: 1 })).value.project.projectId, project.projectId);
    assert.equal(current.creates()[1].body.attempt, lost.body.attempt);
});

test('the same form after another sign-in is that account\'s own request, and the earlier one delivers nothing', async () => {
    const current = await worker();
    // The first account's create reaches uier; its answer is on its way
    let arrive;
    const delayed = new Promise(resolve => { arrive = resolve; });
    current.api.answer = request => request.path === 'projects' && request.method === 'POST' ? delayed : usual(request);
    const earlier = current.send({ ...submission, tabId: 1 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(current.creates().map(request => request.token), ['Bearer token-a']);

    // Another account signs in and sends the same form from the same tab: its own request, with its own credential
    await signInAgain(current, request => request.path === 'projects' && request.method === 'POST' ? delayed : usual(request));
    const theirs = { ...project, id: 'public-b', projectId: 'bbbbbbbbbbbb' };
    current.api.answer = request => request.path === 'projects' && request.method === 'POST' ? json(theirs, 201) : usual(request);
    assert.equal((await current.send({ ...submission, tabId: 1 })).value.project.projectId, theirs.projectId);
    const sent = current.creates();
    assert.deepEqual(sent.map(request => request.token), ['Bearer token-a', 'Bearer token-b']);
    assert.notEqual(sent[1].body.attempt, sent[0].body.attempt);
    const reviews = () => current.requests.filter(request => request.path === 'scope').map(request => [request.token, request.body.projectId]);
    assert.deepEqual(reviews(), [['Bearer token-b', theirs.projectId]]);

    // The first account's answer arrives now. Nobody gets its project, and no review starts for it in this sign-in
    arrive(json(project, 201));
    assert.deepEqual(await earlier, { ok: false, error: 'This sign-in has ended.' });
    assert.deepEqual(reviews(), [['Bearer token-b', theirs.projectId]]);
    assert.deepEqual(current.attempts(), [{ attempt: sent[1].body.attempt }]);
});

test('an attempt outlives refusals, broken answers and success, and ends when uier says its project is gone', async () => {
    const current = await worker();
    // A refusal and an answer that broke off keep the attempt
    current.api.answer = request => request.path === 'projects' ? json({ error: 'rate_limited', message: 'Too many new projects. Try again later.' }, 429) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 1 }), { ok: false, error: 'Too many new projects. Try again later.' });
    current.api.answer = request => request.path === 'projects' ? new Response('{"id":"public-id","projec', { status: 201 }) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 1 }), { ok: false, error: 'The answer from uier was interrupted. Try again.' });
    current.api.answer = usual;
    await current.send({ ...submission, tabId: 1 });
    // So does success, and discovery listing the project: a form still open somewhere stays the same request
    current.api.answer = request => request.path.startsWith('projects?') ? json({ projects: [project], workspaces: [], canSetUp: true }) : usual(request);
    assert.equal((await current.send({ type: 'state' })).ok, true);
    await current.send({ ...submission, tabId: 2 });
    const sent = current.creates().map(request => request.body.attempt);
    assert.deepEqual(sent, Array(4).fill(sent[0]));
    assert.deepEqual(current.attempts(), [{ attempt: sent[0] }]);
    // uier says the attempt's project was removed since: the same form is a new submission, for every window
    current.api.answer = request => request.path === 'projects' ? json({ error: 'not_found', message: 'This project no longer exists.' }, 410) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 2 }), { ok: false, error: 'This project no longer exists.' });
    assert.deepEqual(current.attempts(), []);
    current.api.answer = usual;
    await current.send({ ...submission, tabId: 2 });
    await current.send({ ...submission, tabId: 1 });
    const later = current.creates().slice(5).map(request => request.body.attempt);
    assert.equal(later.length, 2);
    assert.notEqual(later[0], sent[0]);
    assert.equal(later[1], later[0]);
    // Sign-out ends every record
    assert.deepEqual(await current.send({ type: 'sign-out' }), { ok: true });
    assert.deepEqual(current.attempts(), []);
});
