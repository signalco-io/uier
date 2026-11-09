import { validate as validateExtension } from '@uier/extension-core/validate';
import { resolve } from 'node:path';
export const validate = directory => validateExtension(directory, { root: resolve(import.meta.dirname, '..'), browser: 'chrome' });
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const result = await validate();
    console.log(`Validated uier ${result.manifest.version}: ${result.files.length} packaged resources`);
}
