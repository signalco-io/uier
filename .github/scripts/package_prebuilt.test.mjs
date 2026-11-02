import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packagePrebuilt } from './package_prebuilt.mjs';

test('function dependencies and internal links survive without the build checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uier-prebuilt-'));
    try {
        const configPath = join(root, '.vercel/output/functions/api.func/.vc-config.json');
        await mkdir(join(root, '.vercel/output/functions/api.func'), { recursive: true });
        await mkdir(join(root, 'node_modules/library'), { recursive: true });
        await writeFile(join(root, 'node_modules/library/index.js'), 'fixture');
        await symlink('library', join(root, 'node_modules/alias'));
        await writeFile(configPath, JSON.stringify({ filePathMap: {
            'lib/index.js': 'node_modules/library/index.js', 'lib/alias': 'node_modules/alias',
        } }));
        await packagePrebuilt(root);
        await rm(join(root, 'node_modules'), { recursive: true });
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        assert.equal(await readFile(join(root, '.vercel/output/runtime-files/node_modules/alias/index.js'), 'utf8'), 'fixture');
        assert.ok(Object.values(config.filePathMap).every(path => path.startsWith('.vercel/output/runtime-files/')));
        assert.deepEqual(Object.keys(config.filePathMap), ['lib/index.js', 'lib/alias']);
        for (const source of Object.values(config.filePathMap))
            await stat(join(root, source));
    } finally { await rm(root, { recursive: true, force: true }); }
});
