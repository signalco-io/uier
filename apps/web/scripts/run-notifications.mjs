import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { maskEnvironmentFile } from './mask-environment.mjs';

// Vercel writes dotenv, not shell code. Never source it, print it, or upload it as an artifact.
if (process.argv[2]) {
    const environmentFile = resolve(process.argv[2]);
    if (process.env.GITHUB_ACTIONS === 'true') maskEnvironmentFile(environmentFile);
    process.loadEnvFile(environmentFile);
}
await mkdir('.next', { recursive: true });
const outfile = resolve('.next/notifications-worker.mjs');
await build({ entryPoints: ['scripts/notifications-worker.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
    external: ['@azure/*', '@vercel/*', 'next/*'], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await import(outfile);
