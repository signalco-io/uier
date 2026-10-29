import './copy-fonts.mjs';
// Copies the production build of the uier toolbar (`@uier/toolbar`, packages/toolbar) to
// public/toolbar.js, so this app serves it at /toolbar.js (headers in next.config.ts) and the
// landing page embeds it like a customer site would.
//
// Runs as the first step of `pnpm build`. Turborepo builds `@uier/toolbar` before this app
// (`^build`), and Vercel builds through Turborepo too (vercel.json `buildCommand`).
// The copy is generated: it is gitignored and a Turborepo build output.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(appDir, 'public', 'toolbar.js');

function fail(message) {
    console.error(`[copy-toolbar] ${message}`);
    process.exit(1);
}

let source;
try {
    // `@uier/toolbar` exports its bundle (dist/index.js)
    source = createRequire(import.meta.url).resolve('@uier/toolbar');
} catch {
    fail('The toolbar bundle (packages/toolbar/dist/index.js) was not found. Build it first: run `pnpm build` from the repository root (Turborepo builds @uier/toolbar before @uier/web).');
}

// The toolbar's watch build (`pnpm dev`) writes a development bundle to the same file; it talks to
// http://localhost:4004 and must never be deployed.
if (readFileSync(source, 'utf8').includes('http://localhost:4004')) {
    fail(`${relative(appDir, source)} is a development build of the toolbar. Run \`pnpm build\` from the repository root to rebuild it for production.`);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[copy-toolbar] ${relative(appDir, source)} -> ${relative(appDir, target)}`);
