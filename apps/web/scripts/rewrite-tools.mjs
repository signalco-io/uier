import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
const output = resolve(root, '.next', `rewrite-tools-${process.pid}.mjs`);
try {
    if (!['report', 'evaluate'].includes(command)) throw new Error('Choose report or evaluate');
    await mkdir(dirname(output), { recursive: true });
    await build({ entryPoints: [resolve(root, `scripts/rewrite-${command}.ts`)], outfile: output,
        bundle: true, platform: 'node', format: 'esm', external: ['next/*', '@azure/*', '@vercel/*', 'sharp'],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
    await (await import(output)).main(args);
} catch (error) {
    // Never echo provider exceptions, which may include request or response content.
    process.stderr.write(command === 'report' && error instanceof Error && error.message.startsWith('Usage:')
        ? `${error.message}\n` : 'Rewrite tool failed. Check arguments, input, or credential availability. No provider payload was logged.\n');
    process.exitCode = 1;
} finally { await rm(output, { force: true }); }
