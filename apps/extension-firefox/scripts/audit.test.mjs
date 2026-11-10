import { test } from 'node:test';
import { resolve } from 'node:path';
import { checkPackagedAudit } from '@uier/extension-core/audit-asset';

test('the audit asset is a file of the package, apart from the content script, and hands over in the isolated world', async () => {
    await checkPackagedAudit(resolve(import.meta.dirname, '../dist'));
});
