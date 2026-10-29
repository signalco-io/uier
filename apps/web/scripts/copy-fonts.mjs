import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish the same pinned Geist package used by next/font, including its font license.
const source = dirname(createRequire(import.meta.url).resolve('geist/font'));
const target = join(dirname(fileURLToPath(import.meta.url)), '../public/toolbar-fonts');
mkdirSync(target, { recursive: true });
for (const [from, to] of [
    ['fonts/geist-sans/Geist-Variable.woff2', 'geist.woff2'],
    ['fonts/geist-mono/GeistMono-Variable.woff2', 'geist-mono.woff2'],
    ['../LICENSE.txt', 'LICENSE.txt']
]) copyFileSync(join(source, from), join(target, to));
