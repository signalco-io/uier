import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = dirname(createRequire(import.meta.url).resolve('@scalar/api-reference'));
const target = fileURLToPath(new URL('../public/scalar/', import.meta.url));
mkdirSync(target, { recursive: true });
copyFileSync(join(dist, 'browser/standalone.js'), join(target, 'standalone.js'));
