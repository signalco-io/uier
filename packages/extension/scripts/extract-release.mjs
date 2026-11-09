import { execFileSync } from 'node:child_process';
import { extractArtifact, releaseVersion } from './release.mjs';
import { resolve } from 'node:path';
const browser = process.argv[2];
await extractArtifact({ root: resolve(import.meta.dirname, '../../..', `apps/extension-${browser}`), browser, version: releaseVersion(process.env.RELEASE_TAG),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() });
