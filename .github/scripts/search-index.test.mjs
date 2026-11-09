import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedUrls, contentHash, publicUrl, validateManifest, submit, config } from './search-index.mjs';

const revision = 'a'.repeat(40);
const manifest = entries => ({ version: 1, revision, pages: entries.map(([path, content]) => ({ url: `https://uier.io${path}`, hash: contentHash(content) })) });
const page = (text, extra = '') => `<head><title>uier</title>${extra}</head><body><main><p>${text}</p><a href="/guides">Guides</a></main></body>`;

function compareOutput(t, previous, current) {
    const dir = mkdtempSync(join(tmpdir(), 'uier-search-index-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const before = join(dir, 'before.json');
    const after = join(dir, 'after.json');
    writeFileSync(before, JSON.stringify(previous));
    writeFileSync(after, JSON.stringify(current));
    return execFileSync(process.execPath,
        [fileURLToPath(new URL('./search-index.mjs', import.meta.url)), 'compare', before, after],
        { encoding: 'utf8', stdio: 'pipe' });
}

test('semantic hashes ignore framework code, CSS, class changes and social-card build keys', () => {
    const a = page('Review a site', '<meta property="og:image" content="https://uier.io/guides/opengraph-image?abcdef123"/><style>.x{color:red}</style>');
    const b = page('Review a site', '<meta property="og:image" content="https://uier.io/guides/opengraph-image?987654fed"/><script>randomBuildId=2</script>');
    assert.equal(contentHash(a), contentHash(b.replace('<main>', '<main class="other">')));
    assert.notEqual(contentHash(a), contentHash(a.replace('Review a site', 'Review a client site')));
    assert.notEqual(contentHash(a), contentHash(a.replace('href="/guides"', 'href="/security"')));
});

test('JSON-LD and metadata changes notify search engines', () => {
    const a = page('Review', '<script type="application/ld+json">{"name":"uier"}</script>');
    assert.notEqual(contentHash(a), contentHash(a.replace('"uier"', '"signalco"')));
    assert.notEqual(contentHash(a), contentHash(a.replace('<title>uier', '<title>Guides')));
});

test('only exact public canonical addresses can enter a manifest', () => {
    for (const value of ['https://other.example/', 'http://uier.io/', 'https://uier.io/app', 'https://uier.io/app/projects/private',
        'https://uier.io/api/comments', 'https://uier.io/notifications', 'https://uier.io/review-session', 'https://uier.io/og/sign-in',
        'https://uier.io/guides?token=secret', 'https://uier.io/#secret', 'https://user:password@uier.io/', 'https://uier.io/%61pp'])
        assert.throws(() => publicUrl(value), value);
    assert.equal(publicUrl('https://uier.io/guides/nextjs'), 'https://uier.io/guides/nextjs');
    const valid = manifest([['/', 'home']]);
    assert.throws(() => validateManifest({ ...valid, pages: [] }));
    assert.throws(() => validateManifest({ ...valid, pages: [...valid.pages, ...valid.pages] }));
    assert.throws(() => validateManifest({ ...valid, revision: 'unknown' }));
});

test('the diff includes additions, edits and removals, and excludes unchanged pages', () => {
    const before = manifest([['/', 'home'], ['/brand', 'old'], ['/security', 'removed']]);
    const after = manifest([['/', 'home'], ['/brand', 'new'], ['/guides', 'added']]);
    assert.deepEqual(changedUrls(before, after), ['https://uier.io/brand', 'https://uier.io/guides', 'https://uier.io/security']);
    assert.deepEqual(changedUrls(null, after), after.pages.map(p => p.url).sort());
});

test('unchanged deployments make no external submission', async () => {
    const current = manifest([['/', 'home']]);
    assert.deepEqual(await submit(current, current, revision, () => { throw new Error('Unexpected request'); }), { status: 'unchanged', count: 0 });
});

test('the workflow skips notification for identical public content in a new revision', t => {
    const before = manifest([['/', page('Review', '<script>oldBuild()</script>')]]);
    const current = { ...manifest([['/', page('Review', '<script>newBuild()</script>')]]), revision: 'b'.repeat(40) };
    assert.equal(compareOutput(t, before, current), 'changed=false\n');
});

test('the workflow enables notification for added, edited, removed and first-deployment public pages', t => {
    const before = manifest([['/', 'home'], ['/brand', 'brand']]);
    for (const current of [
        manifest([['/', 'home'], ['/brand', 'brand'], ['/guides', 'guide']]),
        manifest([['/', 'updated home'], ['/brand', 'brand']]),
        manifest([['/', 'home']]),
    ]) assert.equal(compareOutput(t, before, current), 'changed=true\n');
    assert.equal(compareOutput(t, null, before), 'changed=true\n');
});

test('the workflow comparison fails instead of skipping on invalid manifests', t => {
    const valid = manifest([['/', 'home']]);
    assert.throws(() => compareOutput(t, { ...valid, revision: 'invalid' }, valid));
    assert.throws(() => compareOutput(t, valid, { ...valid, pages: [] }));
});

test('submission verifies the deployed revision and public proof before sending only the diff', async () => {
    const before = manifest([['/', 'home']]);
    const current = manifest([['/', 'home'], ['/guides', 'guide']]);
    let calls = 0;
    const fetcher = async (url, options) => {
        calls++;
        if (url === config.keyLocation) return new Response(`${config.key}\n`);
        assert.equal(url, 'https://api.indexnow.org/indexnow');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), { ...config, urlList: ['https://uier.io/guides'] });
        return new Response(null, { status: 202 });
    };
    assert.deepEqual(await submit(before, current, revision, fetcher), { status: 'key-validation-pending', count: 1 });
    assert.equal(calls, 2);
    await assert.rejects(submit(before, current, 'b'.repeat(40), fetcher), /another commit/);
    assert.equal(calls, 2);
    await assert.rejects(submit(before, current, revision, async () => new Response('wrong key')), /key does not match/);
    await assert.rejects(submit(before, current, revision, async url => url === config.keyLocation
        ? new Response(config.key) : new Response(null, { status: 429 })), /HTTP 429/);
});
