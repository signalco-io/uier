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

test('builds have no deployment secrets and deployment jobs never execute checkout code', () => {
    const build = readFileSync(join(root, '.github/workflows/vercel-build_reusable.yml'), 'utf8');
    const deploy = readFileSync(join(root, '.github/workflows/vercel-deploy_reusable.yml'), 'utf8');
    assert.doesNotMatch(build, /secrets\.|VERCEL_TOKEN|vercel pull|environment:/);
    assert.match(build, /path: prebuilt\.tar\.gz/);
    const artifact = 'name: vercel-output-${{ github.run_id }}-${{ github.run_attempt }}';
    assert.ok(build.includes(artifact));
    assert.ok(deploy.includes(artifact));
    assert.doesNotMatch(deploy, /uses: actions\/checkout|pnpm (?:install|build)|vercel pull/);
    assert.match(deploy, /environment:.*production.*preview/);
    assert.match(deploy, /--ignore-scripts/);
    const worker = readFileSync(join(root, '.github/workflows/notifications.yml'), 'utf8');
    assert.doesNotMatch(worker, /VERCEL_TOKEN|vercel pull|\.env\.production/);
    assert.match(worker, /environment: production-worker/);
    assert.match(worker, /UIER_WORKER_SETTINGS: \$\{\{ secrets\.UIER_WORKER_SETTINGS \}\}/);
    const pulumi = readFileSync(join(root, '.github/workflows/pulumi_reusable.yml'), 'utf8');
    assert.match(pulumi, /environment:.*inputs\.command == 'up'.*'production'.*'preview'/);
    assert.match(pulumi, /ANTHROPIC_API_KEY:.*inputs\.command == 'up'/);
    assert.match(pulumi, /UIER_INTEGRATION_ENV:.*inputs\.command == 'up'/);
});

test('production builds overlap infrastructure but publishing waits for both', () => {
    const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
    const job = name => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
    assert.match(job('build'), /uses: \.\/\.github\/workflows\/vercel-build_reusable\.yml/);
    assert.doesNotMatch(job('build'), /needs:|secrets:/);
    assert.doesNotMatch(job('infra'), /needs:/);
    assert.match(job('web'), /needs: \[infra, build\]/);
    assert.doesNotMatch(job('web'), /^    if:/m);
    assert.match(job('web'), /uses: \.\/\.github\/workflows\/vercel-deploy_reusable\.yml/);
    assert.match(job('indexnow'), /needs: \[web, build\]/);
    assert.match(job('indexnow'), /needs\.build\.outputs\.public-pages-changed/);
    assert.match(workflow, /group: deploy-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false/);
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    assert.match(ci, /name: "Web \(Vercel preview\)"\n    needs: preview-build/);
    assert.match(ci, /needs: \[changes, web, infra, preview-build, preview,/);
    assert.ok(ci.includes('".github/workflows/vercel-*_reusable.yml"'));
    const build = readFileSync(join(root, '.github/workflows/vercel-build_reusable.yml'), 'utf8');
    assert.match(build, /UIER_TOOLBAR_RETAIN_FROM: https:\/\/uier\.io/);
    assert.match(build, /TURBO_FORCE: "true"/);
});

// GitHub requires callers to reference each allowed secret for environment resolution.
test('reusable callers allowlist environment secrets and keep production integrations out of previews', () => {
    for (const name of ['ci.yml', 'deploy.yml']) {
        const workflow = readFileSync(join(root, '.github/workflows', name), 'utf8');
        assert.doesNotMatch(workflow, /secrets: inherit/);
        const references = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]);
        const allowed = new Set(['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID',
            'AZURE_STORAGE_ACCOUNT', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN',
            ...(name === 'deploy.yml' ? ['UIER_INTEGRATION_ENV', 'ANTHROPIC_API_KEY'] : [])]);
        assert.ok(references.length >= 7);
        assert.ok(references.every(key => allowed.has(key)));
    }
});
