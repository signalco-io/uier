import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkPackagedNotices, noticesFile } from '@uier/extension-core/notices';
import { validate } from './validate.mjs';

const dist = resolve(import.meta.dirname, '../dist');

test('the package carries the third-party notices with the UI kit\'s MIT notice', async () => {
    await checkPackagedNotices(dist);
});

test('validation refuses a package that lost its third-party notices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-extension-notices-'));
    try {
        await cp(dist, directory, { recursive: true });
        await validate(directory);
        await rm(join(directory, noticesFile));
        await assert.rejects(validate(directory), /Missing packaged file THIRD-PARTY-NOTICES\.txt/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
