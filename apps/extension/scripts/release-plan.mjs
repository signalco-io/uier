// Regular releases (docs/browser-extension-release.md, "Regular releases"). `plan` decides whether
// shipped source changed since the newest release tag; `version X.Y.Z` sets the version everywhere
// it is recorded. Creating the protected tag stays with release owners.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareVersions, validateTag } from './store-api.mjs';

/** Source bundled into the packages. Dependency-only updates ship with the next one, or a forced run. */
export const shippedPaths = ['packages/toolbar/src', 'packages/toolbar/tailwind.config.js', 'packages/extension/src',
    'packages/extension/scripts/build.mjs', 'packages/extension/scripts/manifest.mjs', 'packages/brand/src', 'packages/brand/tokens.css'];
const packages = ['apps/extension/package.json', 'apps/extension-firefox/package.json'];
const webVersion = 'apps/web/src/lib/extension/release.ts';
const webPattern = /export const latestExtensionVersion = '([^']*)';/;

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function recordedVersions(root) {
    const web = webPattern.exec(readFileSync(resolve(root, webVersion), 'utf8'))?.[1];
    return [...packages.map(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')).version), web];
}

export function setVersion(root, version) {
    validateTag(`extension-v${version}`);
    for (const path of packages) {
        const file = resolve(root, path), text = readFileSync(file, 'utf8');
        const next = text.replace(/^(  "version": )"[^"]*"/m, `$1"${version}"`);
        if (next === text && JSON.parse(text).version !== version) throw new Error(`No version field in ${path}`);
        writeFileSync(file, next);
    }
    const file = resolve(root, webVersion), text = readFileSync(file, 'utf8');
    if (!webPattern.test(text)) throw new Error(`No latestExtensionVersion in ${webVersion}`);
    writeFileSync(file, text.replace(webPattern, `export const latestExtensionVersion = '${version}';`));
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
    // Merged but never tagged: the owner still has to create the tag, a new bump would skip a version.
    if (compareVersions(current, latest.version) > 0) return { state: 'untagged', version: current, tag: latest.tag, changes: [] };
    const changes = git(root, 'log', '--format=%h %s', `${latest.tag}..HEAD`, '--', ...shippedPaths).split('\n').filter(Boolean);
    if (!changes.length && !force) return { state: 'current', version: current, tag: latest.tag, changes };
    const [major, minor, patch] = latest.version.split('.').map(Number);
    return { state: 'due', version: `${major}.${minor}.${patch + 1}`, tag: latest.tag, changes };
}

export function pullRequestBody({ version, tag, changes }, repository = 'https://github.com/signalco-io/uier') {
    return [
        `Prepares extension ${version}. Shipped source changed since \`${tag}\`:`, '',
        ...(changes.length ? changes.map(change => `- ${change}`) : ['- No source changes; a manual run asked for a release.']), '',
        '## After merging', '',
        'A release owner creates the protected tag on main, then approves the `extension-production` review in the **Extension release** run:', '',
        '```sh', `git fetch origin main && git tag -a extension-v${version} -m "uier extension ${version}" origin/main && git push origin extension-v${version}`, '```', '',
        'Pull requests opened by GitHub Actions start no workflows, so the job dispatched **CI** on this branch. Rerun it there after pushing more commits.',
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
