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
    current.api.answer = request => request.path === 'token' ? json({ token: 'token-b', expiresAt: Date.now() + 600_000, refreshToken: 'refresh-b', refreshExpiresAt: Date.now() + 86_400_000 })
        : request.path === 'session' ? new Response(null, { status: 204 })
            : request.path === 'projects' && request.method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : usual(request);
    assert.deepEqual(await current.send({ type: 'sign-in' }), { ok: true });
    assert.notEqual(current.session.values.get('extension-session-v1').id, 'session-a');
    assert.equal((await current.send({ ...submission, tabId: 1 })).ok, false);
    const [lost] = current.creates();
    assert.equal(lost.token, 'Bearer token-b');
    assert.deepEqual(current.attempts().map(record => record.attempt), [lost.body.attempt]);

    // Now the old answer arrives. It says nothing about the new sign-in: the attempt stays for the retry
    arrive(json({ projects: [], workspaces: [], canSetUp: true }));
    assert.equal((await discovery).ok, true);
    assert.deepEqual(current.attempts().map(record => record.attempt), [lost.body.attempt]);
    current.api.answer = usual;
    assert.equal((await current.send({ ...submission, tabId: 1 })).value.project.projectId, project.projectId);
    assert.equal(current.creates()[1].body.attempt, lost.body.attempt);
});

test('an attempt ends when discovery lists its project, and only then', async () => {
    const current = await worker();
    // A refusal and an answer that broke off keep the attempt
    current.api.answer = request => request.path === 'projects' ? json({ error: 'rate_limited', message: 'Too many new projects. Try again later.' }, 429) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 1 }), { ok: false, error: 'Too many new projects. Try again later.' });
    current.api.answer = request => request.path === 'projects' ? new Response('{"id":"public-id","projec', { status: 201 }) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 1 }), { ok: false, error: 'The answer from uier was interrupted. Try again.' });
    current.api.answer = usual;
    await current.send({ ...submission, tabId: 1 });
    const sent = current.creates().map(request => request.body.attempt);
    assert.deepEqual(sent, [sent[0], sent[0], sent[0]]);
    assert.deepEqual(current.attempts().map(record => [record.attempt, record.projectId]), [[sent[0], project.projectId]]);
    // Discovery without the project (another site's answer, a list that does not have it yet) ends nothing
    assert.equal((await current.send({ type: 'state' })).ok, true);
    assert.equal(current.attempts().length, 1);
    current.api.answer = request => request.path.startsWith('projects?') ? json({ projects: [project], workspaces: [], canSetUp: true }) : usual(request);
    assert.equal((await current.send({ type: 'state' })).ok, true);
    assert.deepEqual(current.attempts(), []);
    // uier says the attempt's project was removed since: the same form is a new submission
    current.api.answer = usual;
    await current.send({ ...submission, tabId: 2, name: 'Removed' });
    current.api.answer = request => request.path === 'projects' ? json({ error: 'not_found', message: 'This project no longer exists.' }, 410) : usual(request);
    assert.deepEqual(await current.send({ ...submission, tabId: 2, name: 'Removed' }), { ok: false, error: 'This project no longer exists.' });
    assert.deepEqual(current.attempts(), []);
    current.api.answer = usual;
    await current.send({ ...submission, tabId: 2, name: 'Removed' });
    const removed = current.creates().filter(request => request.body.name === 'Removed').map(request => request.body.attempt);
    assert.equal(removed[0], removed[1]);
    assert.notEqual(removed[2], removed[0]);
});
