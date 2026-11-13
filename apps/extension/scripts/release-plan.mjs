// Regular releases (docs/browser-extension-release.md, "Regular releases"). `plan` decides whether
// shipped source changed since the newest release tag; `version X.Y.Z` sets the version everywhere
// it is recorded. The daily automation merges the version PR after CI and creates its release tag.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareVersions, validateTag } from './store-api.mjs';

/** Only toolbar implementation changes trigger daily releases. Other changes ride the next release. */
export const shippedPaths = ['packages/toolbar/src', 'packages/toolbar/tailwind.config.js',
    'packages/toolbar/postcss.config.mjs', 'packages/toolbar/tsup.config.ts'];
const packages = ['apps/extension/package.json', 'apps/extension-firefox/package.json'];
const webVersion = 'apps/web/src/lib/extension/release.ts';
export const versionPaths = [...packages, webVersion];
const webPattern = /export const latestExtensionVersion = '([^']*)';/;

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function recordedVersions(root) {
    const web = webPattern.exec(readFileSync(resolve(root, webVersion), 'utf8'))?.[1];
    return [...packages.map(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')).version), web];
}

export function versionedText(path, text, version) {
    validateTag(`extension-v${version}`);
    const pattern = path === webVersion ? webPattern : /^(  "version": )"[^"]*"/m;
    if (!pattern.test(text)) throw new Error(`No version field in ${path}`);
    return text.replace(pattern, path === webVersion
        ? `export const latestExtensionVersion = '${version}';` : `$1"${version}"`);
}

export function setVersion(root, version) {
    validateTag(`extension-v${version}`);
    for (const path of versionPaths) {
        const file = resolve(root, path), text = readFileSync(file, 'utf8');
        writeFileSync(file, versionedText(path, text, version));
    }
}

export function nextVersion(version) {
    validateTag(`extension-v${version}`);
    const parts = version.split('.').map(Number);
    for (let index = 2; index >= 0; index--) {
        if (parts[index] < 65535) { parts[index]++; return parts.join('.'); }
        parts[index] = 0;
    }
    throw new Error('Extension version space is exhausted');
}

export function plan(root, { force = false } = {}) {
    const versions = recordedVersions(root);
    if (new Set(versions).size !== 1) throw new Error(`Versions differ: ${versions.join(', ')}. Run the release:version script.`);
    const [current] = versions;
    const tags = git(root, 'tag', '--list', 'extension-v*').split('\n').filter(Boolean).flatMap(tag => {
        try { return [{ tag, version: validateTag(tag) }]; } catch { return []; }
    }).sort((a, b) => compareVersions(b.version, a.version));
    const latest = tags[0];
    if (!latest) throw new Error('No extension release tag found.');
    git(root, 'merge-base', '--is-ancestor', latest.tag, 'HEAD');
    if (compareVersions(current, latest.version) < 0) throw new Error('Recorded version is behind the newest release tag');
    // Recover an interrupted finalization before considering another version.
    if (compareVersions(current, latest.version) > 0) return { state: 'untagged', version: current, tag: latest.tag, changes: [] };
    const changed = git(root, 'diff', '--name-only', latest.tag, 'HEAD', '--', ...shippedPaths);
    if (!changed && !force) return { state: 'current', version: current, tag: latest.tag, changes: [] };
    const changes = git(root, 'log', '--format=%h %s', `${latest.tag}..HEAD`, '--', ...shippedPaths).split('\n').filter(Boolean);
    return { state: 'due', version: nextVersion(latest.version), tag: latest.tag, changes };
}

export function pullRequestBody({ version, tag, changes }, repository = 'https://github.com/signalco-io/uier') {
    return [
        `Prepares extension ${version}. Shipped source changed since \`${tag}\`:`, '',
        ...(changes.length ? changes.map(change => `- ${change}`) : ['- No source changes; a manual run asked for a release.']), '',
        'The daily release automation synchronizes this version-only branch with the repository deploy key to start **CI**. After it passes, **Extension release finish** verifies that this PR changes only the three recorded versions, merges it, creates the immutable release tag, and starts store submission and the website deployment.', '',
        'Store review and signing may still be pending after submission. No release is prepared when the toolbar has no changes since the last release.',
        `See [regular releases](${repository}/blob/main/docs/browser-extension-release.md#regular-releases).`
    ].join('\n');
}

if (import.meta.main) {
    const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
    const [command, value] = process.argv.slice(2);
    if (command === 'version') {
        setVersion(root, value);
        console.log(`Extension version set to ${value}`);
    } else if (command === 'plan') {
        const result = plan(root, { force: process.env.FORCE === 'true' });
        console.log(`${result.state}: ${result.version} (newest tag ${result.tag}, ${result.changes.length} shipped changes)`);
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\nversion=${result.version}\ntag=${result.tag}\n`);
        if (process.env.RELEASE_BODY && result.state === 'due') writeFileSync(process.env.RELEASE_BODY,
            pullRequestBody(result, process.env.GITHUB_REPOSITORY && `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`));
    } else {
        throw new Error('Use: release-plan.mjs plan | version X.Y.Z');
    }
}
