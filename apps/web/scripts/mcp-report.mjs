import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Summarizes exported `mcp_request` log events: node scripts/mcp-report.mjs logs.ndjson YYYY-MM-DD production
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.next', `mcp-report-${process.pid}.mjs`);
try {
    await mkdir(dirname(output), { recursive: true });
    await build({ entryPoints: [resolve(root, 'scripts/mcp-report.ts')], outfile: output,
        bundle: true, platform: 'node', format: 'esm', external: ['next/*', '@azure/*', '@vercel/*', 'sharp'],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
    await (await import(output)).main(process.argv.slice(2));
} catch (error) {
    // Never echo an exception: a parser or file error could quote a log line.
    process.stderr.write(error instanceof Error && error.message.startsWith('Usage:')
        ? `${error.message}\n` : 'MCP report failed. Check the arguments and that the log file can be read. No log content was printed.\n');
    process.exitCode = 1;
} finally { await rm(output, { force: true }); }
