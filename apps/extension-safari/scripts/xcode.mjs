import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validate } from '@uier/extension-core/validate';

const root = resolve(import.meta.dirname, '..');
const test = process.argv.includes('--test');
const hostedTest = process.argv.includes('--hosted-test');
if (test && hostedTest) throw new Error('Choose either --test or --hosted-test.');
const directory = test ? 'dist-test' : hostedTest ? 'dist-hosted-test' : 'dist';
const resources = resolve(root, directory);
await access(resolve(resources, 'manifest.json'));
if (!test && !hostedTest) await validate(resources, { root, browser: 'safari' });
const manifest = JSON.parse(await readFile(resolve(resources, 'manifest.json'), 'utf8'));
if (manifest.browser_specific_settings || manifest.permissions.includes('identity'))
    throw new Error('Build the Safari resources before creating its Xcode project.');

if (process.platform !== 'darwin') throw new Error('Creating the Safari app requires macOS and full Xcode.');
const tool = ['safari-web-extension-packager', 'safari-web-extension-converter'].find(name =>
    spawnSync('xcrun', ['--find', name], { stdio: 'ignore' }).status === 0);
if (!tool) throw new Error('Install full Xcode and select it with xcode-select before creating the Safari app.');
const projectLocation = resolve(root, 'xcode', directory);
await mkdir(projectLocation, { recursive: true });
// Reference dist rather than copying it: rebuilding the shared package updates the Xcode app too.
// Do not overwrite an existing project, which may contain the owner's signing configuration.
execFileSync('xcrun', [tool, resources, '--project-location', projectLocation, '--app-name', 'uier',
    '--bundle-identifier', 'io.uier.safari', '--macos-only', '--swift', '--no-open', '--no-prompt'], { stdio: 'inherit' });
console.log(`Open the generated project in ${projectLocation}; select your Apple team, then build and run.`);
