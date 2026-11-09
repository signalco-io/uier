import { packageExtension } from '@uier/extension-core/package';
import { resolve } from 'node:path';

await packageExtension({ root: resolve(import.meta.dirname, '..'), browser: 'firefox' });
