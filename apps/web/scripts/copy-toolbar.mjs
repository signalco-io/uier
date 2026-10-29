// Copies the production build of the uier toolbar (`@uier/toolbar`, packages/toolbar) to
// public/toolbar.js and public/toolbar/<sha256>.js, with a retention manifest (headers in
// next.config.ts). The landing page embeds the default like a customer site would.
//
// Runs as the first step of `pnpm build`. Turborepo builds `@uier/toolbar` before this app
// (`^build`), and Vercel builds through Turborepo too (vercel.json `buildCommand`).
// The copy is generated: it is gitignored and a Turborepo build output.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishToolbar } from './toolbar-assets.mjs';

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

const pinned = await publishToolbar(source, dirname(target), { retainFrom: process.env.UIER_TOOLBAR_RETAIN_FROM });
console.log(`[copy-toolbar] ${relative(appDir, source)} -> ${relative(appDir, target)} and ${pinned.path}`);
