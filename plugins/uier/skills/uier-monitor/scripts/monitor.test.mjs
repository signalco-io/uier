import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual standalone script without invoking its CLI or network.
const source = readFileSync(new URL('./monitor.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('import.meta.url', '"file:///monitor.mjs"')
    .split('// Last, so every module-level constant')[0];
function fixture(items, entries) {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map });
    vm.runInContext(source, context);
    context.entries = entries;
    vm.runInContext('allPages = async () => ({ items: entries });', context);
    return { reconcile: context.reconcile, state: { project: { id: 'project' }, items }, seen: {}, found: [] };
}

test('reconcile recovers replies for asked, rejected and ready items, including resolved threads', async () => {
    for (const item of [{ decision: 'asked' }, { decision: 'rejected' }, { decision: 'accepted', stage: 'ready' }]) {
        const entry = { id: 'thread', replyCount: 2, stage: 'open' };
        const f = fixture({ thread: item }, [entry]);
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 0); // migration seeds a baseline
        f.found.length = 0;
        entry.replyCount++;
        entry.resolved = true;
        entry.stage = 'done';
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 1);
        f.found.length = 0;
        await f.reconcile(null, f.state, f.seen, f.found);
        assert.equal(f.found.filter(hit => hit.type === 'reply').length, 0);
    }
});

test('feed replies deduplicate reconcile and still advance the reply baseline', async () => {
    const entry = { id: 'thread', replyCount: 1 };
    const f = fixture({ thread: { decision: 'asked' } }, [entry]);
    await f.reconcile(null, f.state, f.seen, f.found);
    entry.replyCount++;
    f.found.push({ type: 'reply', commentId: 'thread' });
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.length, 1);
    f.found.length = 0;
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.length, 0);
});

test('skipped, active and untracked resolved threads do not produce reply wakes', async () => {
    const entries = ['skipped', 'active', 'closed'].map(id => ({ id, replyCount: 1, resolved: id === 'closed' }));
    const f = fixture({ skipped: { decision: 'skipped', stage: 'ready' }, active: { decision: 'accepted', stage: 'progress' } }, entries);
    await f.reconcile(null, f.state, f.seen, f.found);
    f.found.length = 0;
    entries.forEach(entry => entry.replyCount++);
    await f.reconcile(null, f.state, f.seen, f.found);
    assert.equal(f.found.filter(hit => hit.type === 'reply' || hit.type === 'untracked').length, 0);
});

test('leases forward supplied desktop links, reattach on URL edits/removal, and keep heartbeat identity', async () => {
    const context = vm.createContext({ process: { argv: [] }, Date, Set, Map });
    vm.runInContext(source, context);
    const calls = [];
    context.tool = async (_ctx, name, args) => { calls.push({ name, args }); return {}; };
    const lease = { items: ['thread'], agent: 'claude', sessionId: 'thread-id', sessionUrl: 't3-thread://v2/local-env/thread-id', state: 'working' };
    const state = { project: { id: 'project' }, groups: { g190: { agentLease: lease } } };
    const seen = {}, found = [];
    const tick = () => context.keepLeases(null, state, seen, found, () => {});
    await tick();
    assert.equal(calls[0].name, 'set_feedback_agent');
    assert.equal(calls[0].args.sessionUrl, lease.sessionUrl);
    assert.equal(calls[1].name, 'set_feedback_agent_working');
    assert.equal(calls[1].args.sessionId, 'thread-id');
    assert.equal('sessionUrl' in calls[1].args, false);
    await tick();
    assert.equal(calls.length, 2);
    lease.sessionUrl = 't3-thread://v2/remote-env/thread-id';
    await tick();
    assert.equal(calls[2].args.sessionUrl, lease.sessionUrl);
    delete lease.sessionUrl;
    await tick();
    assert.equal(calls[4].name, 'set_feedback_agent');
    assert.equal('sessionUrl' in calls[4].args, false);
    lease.state = 'done';
    await tick();
    assert.equal(calls[6].name, 'set_feedback_agent_working');
    assert.equal(calls[6].args.working, false);
    assert.equal(calls[6].args.sessionId, 'thread-id');
    assert.equal(found.length, 0);
});
