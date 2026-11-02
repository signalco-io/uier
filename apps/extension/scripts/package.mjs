import { validate } from './validate.mjs';
import { mkdir, readFile, writeFile, rm, mkdtemp, cp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const { manifest, files } = await validate();
const out = resolve(root, 'release');
await mkdir(out, { recursive: true });
const name = `uier-extension-${manifest.version}.zip`;
const target = join(out, name);
await rm(target, { force: true });
// Normalize ZIP timestamps and ordering so reruns of the same source have the same bytes.
const epoch = Math.max(315532800, Number(execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()));
const staging = await mkdtemp(join(tmpdir(), 'uier-extension-package-'));
try {
    for (const file of files) {
        const path = join(staging, file);
        await mkdir(resolve(path, '..'), { recursive: true });
        await cp(join(root, 'dist', file), path);
        await utimes(path, epoch, epoch);
    }
    execFileSync('zip', ['-X', '-q', target, ...files], { cwd: staging, env: { ...process.env, TZ: 'UTC' } });
} finally { await rm(staging, { recursive: true, force: true }); }
const sha256 = createHash('sha256').update(await readFile(target)).digest('hex');
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(`${target}.sha256`, `${sha256}  ${name}\n`);
await writeFile(`${target}.json`, JSON.stringify({ version: manifest.version, commit, dirty, sha256, files, contractVersion: 1 }, null, 2) + '\n');
console.log(`${target}\nSHA-256 ${sha256}`);
