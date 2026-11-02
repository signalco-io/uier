import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const productionPackage = process.env.UIER_EXTENSION_TEST_PACKAGE === '1';
export const extensionPath = resolve(import.meta.dirname, productionPackage ? '../test-package' : '../dist-test');
export const clientId = productionPackage
    ? createHash('sha256').update(extensionPath).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)))
    : readFileSync(resolve(extensionPath, 'development-id.txt'), 'utf8').trim();
export const port = Number(process.env.PORT || 4004);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a valid local test PORT.');
export const localApi = `http://127.0.0.1:${port}`;
export const apiBase = productionPackage ? 'https://uier.io' : localApi;
