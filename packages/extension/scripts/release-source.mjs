import { sourceArchive, releaseVersion } from './release.mjs';
import { resolve } from 'node:path';
const version = releaseVersion(process.env.RELEASE_TAG);
await sourceArchive({ directory: resolve(process.argv[2]), version });
