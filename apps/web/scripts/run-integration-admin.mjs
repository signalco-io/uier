import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

try {
    let input;
    let dotenv;
    for (let index = 2; index < process.argv.length; index += 2) {
        const name = process.argv[index], value = process.argv[index + 1];
        if (!value || (name !== '--input' && name !== '--env') || (name === '--input' ? input : dotenv)) throw new Error();
        if (name === '--input') input = resolve(value); else dotenv = resolve(value);
    }
    if (!input) throw new Error();
    // Dotenv is data. Never source it, log it, or include it in the JSON request.
    if (dotenv) process.loadEnvFile(dotenv);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const output = resolve(root, '.next', `integration-admin-${process.pid}.mjs`);
    await mkdir(dirname(output), { recursive: true });
    await build({ entryPoints: [resolve(root, 'scripts/integration-admin.ts')], outfile: output,
        bundle: true, platform: 'node', format: 'esm', external: ['@azure/*', '@vercel/*', 'next/*'],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
    const script = await import(output);
    await script.integrationAdminMain(input);
} catch {
    process.stderr.write('Usage: node scripts/run-integration-admin.mjs --input request.json [--env production.env]\n');
    process.exitCode = 1;
}
