import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { maskEnvironmentFile } from '../../apps/web/scripts/mask-environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('all external workflow actions have immutable commit pins and version comments', () => {
    for (const name of readdirSync(join(root, '.github/workflows'))) {
        if (!/\.ya?ml$/.test(name)) continue;
        const contents = readFileSync(join(root, '.github/workflows', name), 'utf8');
        const uses = [...contents.matchAll(/\buses:\s*([^\n]+)/g)].map(match => match[1].trim());
        assert.ok(uses.length, `${name} contains no actions`);
        for (const reference of uses) {
            if (reference.startsWith('./')) continue;
            assert.match(reference, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}\s+#\s+v\d[\w.-]*$/, `${name}: ${reference}`);
        }
    }
});

test('dependency automerge cannot include runtime, build, deployment or action updates', () => {
    const config = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
    assert.equal(config.automerge, false);
    assert.ok(config.extends.includes('helpers:pinGitHubActionDigests'));
    const allowed = new Set(['@types/*', '@playwright/test', '@axe-core/playwright']);
    const automatic = config.packageRules.filter(rule => rule.automerge === true);
    assert.ok(automatic.length);
    for (const rule of automatic) {
        assert.deepEqual(rule.matchManagers, ['npm']);
        assert.deepEqual(rule.matchDepTypes, ['devDependencies']);
        assert.ok(rule.matchPackageNames.length);
        assert.ok(rule.matchPackageNames.every(name => allowed.has(name)));
        assert.match(rule.minimumReleaseAge, /^\d+ days$/);
        assert.ok(parseInt(rule.minimumReleaseAge, 10) >= 3);
        assert.ok(rule.matchUpdateTypes.every(type => ['minor', 'patch', 'pin', 'digest'].includes(type)));
    }
});

test('dotenv values are masked without executing them or allowing workflow command injection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'uier-mask-'));
    const file = join(directory, '.env');
    try {
        writeFileSync(file, '# fixture\nTOKEN="first%line\n::warning::private second line"\nPLAIN=private-value\nEMPTY=\nLITERAL=$(touch never-run)\n');
        const output = [];
        maskEnvironmentFile(file, value => output.push(value));
        assert.deepEqual(output.sort(), [
            '::add-mask::first%25line%0A::warning::private second line\n',
            '::add-mask::private-value\n',
            '::add-mask::$(touch never-run)\n',
        ].sort());
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
