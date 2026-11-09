import { validate } from '@uier/extension-core/validate';
import { resolve } from 'node:path';

const result = await validate(undefined, { root: resolve(import.meta.dirname, '..'), browser: 'firefox' });
console.log(`Validated uier ${result.manifest.version} for firefox: ${result.files.length} packaged resources`);
