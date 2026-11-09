import { buildExtension } from '@uier/extension-core/build';
import { resolve } from 'node:path';

await buildExtension({ root: resolve(import.meta.dirname, '..'), browser: 'safari',
    test: process.argv.includes('--test'), hostedTest: process.argv.includes('--hosted-test') });
